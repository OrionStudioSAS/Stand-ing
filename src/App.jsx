import React, { Suspense, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useLoader } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Text } from '@react-three/drei';
import { Box3, BufferGeometry, Cache, CanvasTexture, DoubleSide, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, LoadingManager, MeshStandardMaterial, Plane, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  FileImage,
  FileCheck2,
  Globe2,
  HelpCircle,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Mail,
  Minus,
  Orbit,
  Paperclip,
  Plus,
  RotateCcw,
  Ruler,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { supabase } from './data/supabaseClient.js';
import { catalog, layouts } from './config/catalog.js';
import { carpetColors, wallFabricColors } from './config/colorOptions.js';
import { deleteObjectBankItem, deleteStandPreset, ensureSalonOffer, getSceneByToken, listClients, listObjectBank, listSalons, listScenes, requestSceneAccessCode, saveMondayBoardForPack, saveObjectBankItem, saveSalonOfferBaseItems, saveScene, saveStandPresetConfig, sceneShareUrl, syncMondayScenes, syncSceneContactToMonday, uploadColorGroupFolder, uploadObjectAssetBatPicto, uploadObjectAssetFolder, uploadObjectAssetThumbnail, uploadSceneItemOptionImage, verifySceneAccessCode } from './data/sceneStore.js';
import { exportTechnicalPng } from './technicalExport.js';
import { t as tRaw } from './i18n.js';
import './styles.css';

const LanguageContext = createContext('fr');
function useT() {
  const lang = useContext(LanguageContext);
  return (key, vars) => tRaw(lang, key, vars);
}
function localizeItemLabel(entry = {}, lang = 'fr') {
  if (lang === 'en' && entry?.dimensions?.labelEn) return entry.dimensions.labelEn;
  return entry?.label || '';
}

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const wallSwitchZone = 0.55;
const wallSwitchHysteresis = 0.12;
const objectWallSnapThreshold = 0.75;
const objectWallAxisPadding = 0.65;
const fixedWallHeight = 2.5;
const wallThickness = 0.06;
const floorThickness = 0.01;
const baseboardHeight = 0.06;
const baseboardThickness = 0.003;
const screenDepth = 0.06;
const screenCenterHeight = 1.6;
const wallItemSnap = 0.25;
const carpetFootprintSizeMeters = 1;
const carpetFootprintOverflow = 0.2;
const collisionPadding = 0.04;
const partitionHeadEdgeInset = 0.02;
const partitionHeadBackInset = 0.04;
const partitionHeadWallGap = 0.02;
const partitionHeadWallCoverWidth = 0.6;
const partitionHeadWallAxisInset = 0;
const collisionPlacementStep = 0.25;
const ledSpotAreaMeters = 3;
const ledRailDefaultCenterY = fixedWallHeight - 0.11;
const ceilingObjectBottomY = 3;
const dirtyCarpetColorCodes = ['0219', '0400', '0939'];
const technicalFloorOptions = [
  { id: 'floor4', label: 'Plancher technique 4 cm', height: 0.04, price: 49, reference: 'SMCL02PLA01A', detail: 'Hauteur 4 cm + cornières 4 × 4 cm', rampLabel: 'Rampe PMR 4 cm' },
  { id: 'floor12', label: 'Plancher technique 12 cm', height: 0.12, price: 59, reference: 'SMCL02PLA01B', detail: 'Hauteur 12 cm + cornières 4 × 4 cm + plinthes blanches', rampLabel: 'Rampe PMR 12 cm' },
];
const technicalTrimOptions = [
  { id: 'straight', label: 'Cornière droite' },
  { id: 'sloped', label: 'Cornière inclinée' },
];
const blankTextureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const textureRetryAttempts = 6;
const textureRetryBaseDelay = 320;
Cache.enabled = true;

// Module-level load caches shared between preload phase and components.
// Ensures items render synchronously from cache when the scene mounts.
const _mtlLoadCache = new Map(); // materialUrl -> { promise, result?, error? }
const _objLoadCache = new Map(); // modelUrl   -> { promise, result?, error? }
const _glbLoadCache = new Map(); // modelUrl   -> { promise, result?, error? }

function _ensureMtlCacheEntry(materialUrl, item) {
  if (_mtlLoadCache.has(materialUrl)) return _mtlLoadCache.get(materialUrl);
  const entry = {};
  const loader = new MTLLoader();
  const manager = new LoadingManager();
  manager.setURLModifier((url) => resolveModelResourceUrl(url, item));
  loader.manager = manager;
  loader.setMaterialOptions({ ignoreZeroRGBs: true, side: DoubleSide });
  loader.setResourcePath(assetBaseUrl(materialUrl || item.modelUrl));
  const origParse = loader.parse.bind(loader);
  loader.parse = (text, path) => origParse(rewriteRuntimeMtlReferences(text, item), path);
  entry.promise = loader.loadAsync(materialUrl)
    .then((result) => { entry.result = result; })
    .catch((err) => { entry.error = err; });
  _mtlLoadCache.set(materialUrl, entry);
  return entry;
}

function _ensureObjCacheEntry(modelUrl, materials) {
  if (modelUrl?.toLowerCase().split('?')[0].endsWith('.glb')) return { result: null, promise: Promise.resolve(), error: null };
  if (_objLoadCache.has(modelUrl)) return _objLoadCache.get(modelUrl);
  const entry = {};
  const loader = new OBJLoader();
  if (materials) { materials.preload(); loader.setMaterials(materials); }
  entry.promise = loader.loadAsync(modelUrl)
    .then((result) => { entry.result = result; })
    .catch((err) => { entry.error = err; });
  _objLoadCache.set(modelUrl, entry);
  return entry;
}

function _ensureGlbCacheEntry(modelUrl) {
  if (_glbLoadCache.has(modelUrl)) return _glbLoadCache.get(modelUrl);
  const entry = {};
  const loader = new GLTFLoader();
  entry.promise = loader.loadAsync(modelUrl)
    .then((result) => { entry.result = result; })
    .catch((err) => { entry.error = err; });
  _glbLoadCache.set(modelUrl, entry);
  return entry;
}

const questionCategories = [
  { id: 'technical', label: 'Question technique', icon: '?' },
  { id: 'layout', label: 'Aménagement', icon: '📐' },
  { id: 'signage', label: 'Signalétique', icon: '🏷️' },
  { id: 'suggestion', label: 'Suggestion', icon: '💡' },
  { id: 'urgent', label: 'Demande urgente', icon: '⚡' },
  { id: 'other', label: 'Autre', icon: '📦' },
];
const urgencyLevels = [
  { id: 'normal', label: 'Normal', delay: 'Réponse sous 48h', color: '#13a538' },
  { id: 'important', label: 'Important', delay: 'Réponse sous 24h', color: '#f0c400' },
  { id: 'urgent', label: 'Urgent', delay: 'Réponse sous 4h', color: '#dc2430' },
];
const languages = [
  { id: 'fr', label: 'Français', sublabel: 'Interface en français', short: 'FR', flag: '🇫🇷' },
  { id: 'en', label: 'English', sublabel: 'Interface in English', short: 'EN', flag: '🇬🇧' },
];
const defaultPackNames = ['Confort', 'Business', 'SIAE', 'Prestige'];
const reserveRuleBands = [
  { id: 'small', label: 'Moins de 18 m²', minArea: 0, maxArea: 17.999, includedLabel: 'Aucune réserve incluse' },
  { id: 'medium', label: '18 à 24 m²', minArea: 18, maxArea: 24.999, includedLabel: 'Réserve 2 m²' },
  { id: 'large', label: '25 m² et plus', minArea: 25, maxArea: null, includedLabel: 'Réserve 3 m²' },
];
const partitionHeadRuleBands = [
  { id: 'small', label: 'Moins de 12 m²', minArea: 0, maxArea: 11.999, includedCount: 0 },
  { id: 'medium', label: '12 à 24 m²', minArea: 12, maxArea: 24.999, includedCount: 1 },
  { id: 'large', label: '25 m² et plus', minArea: 25, maxArea: null, includedCount: 2 },
];
const placementRuleOptions = [
  { id: 'free', label: 'Libre', description: "L'utilisateur peut poser et déplacer cet objet normalement." },
  { id: 'back-left', label: 'Coin arrière gauche', description: "L'objet se colle automatiquement dans le coin arrière gauche." },
  { id: 'back-right', label: 'Coin arrière droite', description: "L'objet se colle automatiquement dans le coin arrière droit." },
  { id: 'front-left', label: 'Coin avant gauche', description: "L'objet se colle automatiquement dans le coin avant gauche." },
  { id: 'front-right', label: 'Coin avant droite', description: "L'objet se colle automatiquement dans le coin avant droit." },
  { id: 'outer-left', label: 'Le plus à gauche', description: "L'objet se place sur le mur gauche si disponible, sinon au fond côté gauche." },
  { id: 'outer-right', label: 'Le plus à droite', description: "L'objet se place sur le mur droit si disponible, sinon au fond côté droit." },
  { id: 'back-center', label: 'Centre arrière', description: "L'objet reste centré contre le mur du fond." },
];
const assetCategoryOptions = ['Sol & Cloisons', 'Mobilier', 'Signalétique', 'Multimédia', 'Enseignes', 'Électricité'];
const colorGroupUsageOptions = [
  { id: 'carpet', label: 'Moquette', detail: 'Couleurs proposées pour le sol principal.' },
  { id: 'footprint', label: 'Empreinte moquette', detail: 'Couleurs proposées pour la dalle 1000 × 1000 mm.' },
  { id: 'wallFabric', label: 'Coton cloison', detail: 'Couleurs/textures proposées sur les murs.' },
  { id: 'counter', label: 'Couleurs comptoir', detail: 'Couleurs autorisées dans la popup du comptoir.' },
];

function canRetryTextureUrl(url = '') {
  return /^https?:\/\//i.test(String(url || '')) || String(url || '').startsWith('/');
}

function textureRetryUrl(url = '', attempt = 1) {
  try {
    const nextUrl = new URL(url, window.location.origin);
    nextUrl.searchParams.set('standing_texture_retry', String(attempt));
    return String(url).startsWith('/') ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` : nextUrl.href;
  } catch {
    const separator = String(url).includes('?') ? '&' : '?';
    return `${url}${separator}standing_texture_retry=${attempt}`;
  }
}

function cacheBustedUrl(url = '') {
  if (!url) return '';
  try {
    const nextUrl = new URL(url, window.location.origin);
    nextUrl.searchParams.set('standing_cache', Date.now().toString(36));
    return String(url).startsWith('/') ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` : nextUrl.href;
  } catch {
    const separator = String(url).includes('?') ? '&' : '?';
    return `${url}${separator}standing_cache=${Date.now().toString(36)}`;
  }
}

function makeItem(type, width, depth, layout, catalogEntry = null) {
  const entry = catalogEntry || catalog.find((item) => item.type === type);
  const placementRule = effectivePlacementRule(entry);
  const base = {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type,
    label: entry?.label,
    rotation: 0,
    collisionEnabled: entry?.dimensions?.collisionEnabled !== false,
    placementRule,
    lockedPlacement: isLockedPlacementRule(placementRule),
    movementLocked: Boolean(entry?.movementLocked || entry?.dimensions?.movementLocked),
    deleteLocked: Boolean(entry?.deleteLocked || entry?.dimensions?.deleteLocked),
    rotationLocked: Boolean(entry?.rotationLocked || entry?.dimensions?.rotationLocked),
  };
  const baseY = floorItemBaseY(base, entry);

  if (entry?.isGroup || entry?.children?.length) {
    const item = {
      ...base,
      isGroup: true,
      groupSize: entry.groupSize || [1.2, 1, 1.2],
      children: resolveGroupChildren(entry.children || []),
      x: 0,
      z: Math.min(depth / 2 - 0.9, 0.7),
      y: baseY,
    };
    return applyPlacementRule(item, width, depth, layout);
  }

  if (isCatalogWallEntry(entry, type)) {
    const side = layout === 'right' ? 'right' : layout === 'left' ? 'left' : 'back';
    const size = entry?.modelSize || entry?.dimensions?.size || [];
    const wallItem = {
      ...base,
      isWallItem: !isWallItemType(type),
      modelUrl: entry?.modelUrl,
      modelSize: entry?.modelSize,
      materialUrl: entry?.materialUrl,
      dimensions: entry?.dimensions,
      color: entry?.color,
      wall: side,
      x: 0,
      z: side === 'back' ? -depth / 2 + wallThickness : 0,
      y: defaultWallItemCenterY(entry, type),
      posterHeight: entry?.posterHeight,
      wallDepth: isWallItemType(type) ? undefined : Number(size?.[2] || 0.08),
      lockedPlacement: base.lockedPlacement,
    };
    return constrainItem(wallItem, width, depth, layout);
  }

  return {
    ...base,
    modelUrl: entry?.modelUrl,
    modelSize: entry?.modelSize,
    materialUrl: entry?.materialUrl,
    dimensions: entry?.dimensions,
    color: entry?.color,
    x: 0,
    z: Math.min(depth / 2 - 0.9, 0.7),
    y: baseY,
  };
}

function resolveGroupChildren(children) {
  return children.map((child, index) => {
    const entry = catalog.find((item) => item.type === child.type) || {};
    return {
      ...child,
      id: child.id || `${child.type}-child-${index + 1}`,
      label: child.label || entry.label || child.type,
      modelUrl: child.modelUrl || entry.modelUrl,
      modelSize: child.modelSize || entry.modelSize,
      materialUrl: child.materialUrl || entry.materialUrl,
      dimensions: child.dimensions || entry.dimensions,
      color: child.color || entry.color,
      x: Number(child.x || 0),
      y: Number(child.y || 0),
      z: Number(child.z || 0),
      rotation: Number(child.rotation || 0),
      lockedInGroup: true,
    };
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const sceneToken = params.get('scene');
  const isAdmin = window.location.pathname.replace(/\/$/, '') === '/admin' || params.get('admin') === '1';
  const [scene, setScene] = useState(null);
  const [loading, setLoading] = useState(Boolean(sceneToken) && !isAdmin);
  const [sceneAccessRequired, setSceneAccessRequired] = useState(false);
  const [sceneError, setSceneError] = useState('');
  const [sceneAdminViewer, setSceneAdminViewer] = useState(false);

  useEffect(() => {
    if (isAdmin) return;
    if (!sceneToken) {
      setSceneAdminViewer(false);
      setLoading(false);
      return;
    }

    let mounted = true;
    const loadScene = async () => {
      setLoading(true);
      setSceneError('');
      try {
        if (!supabase) {
          const loaded = await getSceneByToken(sceneToken);
          if (mounted) {
            setSceneAdminViewer(false);
            setScene(loaded);
          }
          return;
        }

        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session?.user) {
          if (mounted) setSceneAccessRequired(true);
          return;
        }

        const { data: adminUser } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (mounted) setSceneAdminViewer(Boolean(adminUser));
        const verified = window.sessionStorage.getItem(`standing-scene-access:${sceneToken}`) === 'verified';

        if (!adminUser && !verified) {
          if (mounted) setSceneAccessRequired(true);
          return;
        }

        const loaded = await getSceneByToken(sceneToken);
        if (mounted) setScene(loaded);
      } catch (error) {
        window.sessionStorage.removeItem(`standing-scene-access:${sceneToken}`);
        if (mounted) {
          setSceneAdminViewer(false);
          setSceneAccessRequired(true);
          setSceneError(error.message || 'Accès à la scène impossible.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadScene();
    return () => {
      mounted = false;
    };
  }, [isAdmin, sceneToken]);

  if (isAdmin) return <AdminGate />;
  if (!sceneToken) return <HomeGate />;
  if (sceneAccessRequired && !scene) {
    return (
      <SceneAccessGate
        sceneToken={sceneToken}
        initialError={sceneError}
        onVerified={async () => {
          window.sessionStorage.setItem(`standing-scene-access:${sceneToken}`, 'verified');
          setSceneAdminViewer(false);
          const loaded = await getSceneByToken(sceneToken);
          setScene(loaded);
          setSceneAccessRequired(false);
        }}
      />
    );
  }
  if (loading || !scene) return <div className="loading-screen">Chargement de la scene...</div>;

  return <ConfiguratorApp initialScene={scene} isAdminViewer={sceneAdminViewer} />;
}

function HomeGate() {
  const [session, setSession] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAdminUser(null);
      setLoading(Boolean(nextSession));
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) return;

    setLoading(true);
    supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setAdminUser(data);
        if (data) window.location.replace('/admin');
      })
      .finally(() => setLoading(false));
  }, [session]);

  if (loading || adminUser) return <div className="loading-screen">Verification admin...</div>;
  return <AdminLogin mode="home" />;
}

function AdminGate() {
  const [session, setSession] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [authChecked, setAuthChecked] = useState(!supabase);
  const [authError, setAuthError] = useState('');
  const sessionUserId = session?.user?.id || '';

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
      if (!data.session) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthError('');
      setAuthChecked(true);

      if (!nextSession?.user) {
        setAdminUser(null);
        setLoading(false);
        return;
      }

      setAdminUser((currentAdmin) => {
        const sameAdmin = currentAdmin?.user_id === nextSession.user.id;
        if (sameAdmin) {
          setLoading(false);
          return currentAdmin;
        }

        setLoading(true);
        return null;
      });
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !authChecked) return;
    if (!sessionUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from('admin_users')
      .select('*')
      .eq('user_id', sessionUserId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setAuthError('Impossible de verifier les droits admin.');
          return;
        }
        if (!data) {
          setAuthError('Compte connecte, mais non autorise en admin.');
          return;
        }
        setAdminUser(data);
      })
      .finally(() => setLoading(false));
  }, [authChecked, sessionUserId]);

  if (!supabase) {
    return (
      <main className="admin-login-shell">
        <LoginHero />
        <section className="admin-login-area">
          <div className="admin-login-card">
            <h1>Supabase non configure</h1>
            <p>Ajoute les variables Vite Supabase pour activer la connexion admin.</p>
          </div>
        </section>
      </main>
    );
  }

  if (loading || !authChecked) return <div className="loading-screen">Verification admin...</div>;
  if (!session || !adminUser) {
    window.location.replace('/');
    return <div className="loading-screen">Redirection...</div>;
  }

  return <AdminDashboard user={session.user} adminProfile={adminUser} />;
}

function LoginHero() {
  return (
    <section className="login-hero">
      <div className="login-logo-bubble">
        <img src="/images/logo.png" alt="Stand-ING" />
        <span>Back-Office Admin</span>
      </div>
      <div className="login-hero-content">
        <h2>Configurez votre stand en 3D.</h2>
        <p>Visualisez chaque détail de votre stand d'exposition avant le jour J.</p>
        <div className="login-stand-preview">
          <img src="/images/image_stand_login.png" alt="Apercu stand 3D" />
        </div>
        <ul>
          <li>Vue 3D temps reel, rotative</li>
          <li>Options, mobilier, signaletique</li>
          <li>BAT electronique integre</li>
          <li>Acces 24h/24, depuis n'importe ou</li>
        </ul>
      </div>
      <div className="login-orb" aria-hidden="true" />
    </section>
  );
}

function SceneAccessGate({ sceneToken, initialError = '', onVerified }) {
  const requested = useRef(false);
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [sending, setSending] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(initialError);

  const sendCode = async () => {
    setSending(true);
    setError('');
    setMessage('');
    try {
      const result = await requestSceneAccessCode(sceneToken);
      setMaskedEmail(result.masked_email || '');
      setMessage('Un code de connexion vient de vous être envoyé.');
    } catch (requestError) {
      setError(requestError.message || "Impossible d'envoyer le code de connexion.");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    sendCode();
  }, [sceneToken]);

  const verifyCode = async (event) => {
    event.preventDefault();
    if (code.trim().length < 6) {
      setError('Saisis le code reçu par email.');
      return;
    }

    setVerifying(true);
    setError('');
    try {
      await verifySceneAccessCode(sceneToken, code.trim());
      await onVerified();
    } catch (verifyError) {
      setError(verifyError.message || 'Code incorrect ou expiré.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className="admin-login-shell">
      <LoginHero />
      <section className="admin-login-area">
        <form className="admin-login-card scene-access-card" onSubmit={verifyCode}>
          <div className="scene-access-icon"><KeyRound size={24} /></div>
          <div className="login-form-heading">
            <h1>Vérifiez votre accès</h1>
            <p>Pour protéger votre configuration, saisissez le code envoyé à l'adresse liée à votre stand.</p>
          </div>
          {maskedEmail && <div className="scene-access-email"><Mail size={16} /> Code envoyé à <strong>{maskedEmail}</strong></div>}
          <label>
            Code de connexion
            <input
              className="scene-access-code"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={10}
              placeholder="00000000"
              autoFocus
            />
          </label>
          {message && <div className="scene-access-message">{message}</div>}
          {error && <div className="admin-login-error">{error}</div>}
          <button className="login-submit" type="submit" disabled={verifying || sending}>
            {verifying ? 'Vérification...' : 'Accéder à ma configuration'}
          </button>
          <button className="scene-access-resend" type="button" onClick={sendCode} disabled={sending}>
            {sending ? 'Envoi en cours...' : 'Renvoyer un code'}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminLogin({ authError = '', mode = 'admin' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [configLink, setConfigLink] = useState('');
  const [showConfigLink, setShowConfigLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(authError);

  useEffect(() => setError(authError), [authError]);
  useEffect(() => {
    if (!supabase) setError('Supabase non configuré : vérifie VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.');
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase non configuré : vérifie VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError('Email ou mot de passe incorrect.');
        setLoading(false);
        return;
      }

      window.location.href = '/admin';
    } catch (error) {
      setError(error.message || 'Connexion admin impossible.');
      setLoading(false);
    }
  };

  const openConfigurationLink = () => {
    const value = configLink.trim();
    if (!value) {
      setError('Colle ton lien de configuration pour continuer.');
      return;
    }

    try {
      const url = new URL(value, window.location.origin);
      const scene = url.searchParams.get('scene');
      if (!scene) {
        setError('Lien invalide : aucun identifiant de scene trouve.');
        return;
      }
      window.location.href = `${window.location.origin}/?scene=${encodeURIComponent(scene)}`;
    } catch {
      setError('Lien invalide.');
    }
  };

  return (
    <main className="admin-login-shell">
      <LoginHero />
      <form className="admin-login-card" onSubmit={submit}>
        <div className="login-form-heading">
          <h1>Connexion</h1>
          <p>{mode === 'admin' ? 'Bienvenue sur le Back-Office Stand-ING' : 'Bienvenue sur Stand-ING'}</p>
        </div>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="contact@aerosys-industries.fr" required />
        </label>
        <label>
          Mot de passe
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" required />
        </label>
        <div className="login-options">
          <label className="remember-field">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Se souvenir de moi
          </label>
          <button type="button">Mot de passe oublie ?</button>
        </div>
        {error && <div className="admin-login-error">{error}</div>}
        <button className="login-submit" disabled={loading || !supabase}>
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
        <div className="login-divider">ou continuer avec</div>
        <p className="login-help">Premiere connexion ? Votre commercial Stand-ING vous a envoye un lien d'acces.</p>
        <button type="button" className="config-link-button" onClick={() => setShowConfigLink((shown) => !shown)}>
          Acceder via mon lien de configuration
        </button>
        {showConfigLink && (
          <div className="config-link-panel">
            <label>
              Lien de configuration
              <input type="url" value={configLink} onChange={(event) => setConfigLink(event.target.value)} placeholder="https://stand-ing.vercel.app/?scene=..." />
            </label>
            <button type="button" className="config-link-open" onClick={openConfigurationLink}>
              Ouvrir ma scene
            </button>
          </div>
        )}
        <small className="login-credit">Developper par - Orion Studio 2026</small>
      </form>
    </main>
  );
}

function ConfiguratorApp({ initialScene, isAdminViewer = false }) {
  const initialOptions = {
    ...(initialScene.source_payload?.options || {}),
    ...(initialScene.options || {}),
  };
  const initialWidth = initialScene.dimensions?.width || 4;
  const initialDepth = initialScene.dimensions?.depth || 3;
  const initialLayout = initialScene.layout || 'u';
  const [width, setWidth] = useState(initialWidth);
  const [depth, setDepth] = useState(initialDepth);
  const height = fixedWallHeight;
  const [layout, setLayout] = useState(initialLayout);
  const [items, setItems] = useState(() => (initialScene.items || []).map((item) => constrainItem(item, initialWidth, initialDepth, initialLayout)));
  const [selectedId, setSelectedId] = useState(() => initialScene.items?.[0]?.id || null);
  const [draggingId, setDraggingId] = useState(null);
  const [orbitControlsActive, setOrbitControlsActive] = useState(false);
  const [technicalFloorRampDragging, setTechnicalFloorRampDragging] = useState(false);
  const [language, setLanguage] = useState(() => {
    if (initialOptions.language) return initialOptions.language;
    const mondayLang = mondayColumnTextAny(initialScene.source_payload, ['langue', 'language']);
    if (/^en(g(lish)?)?$/i.test(mondayLang) || /^anglais$/i.test(mondayLang)) return 'en';
    return 'fr';
  });
  const [fontRevision, setFontRevision] = useState(0);
  const [headerPanel, setHeaderPanel] = useState(null);
  const introStorageKey = useMemo(() => `standing-config-intro:${initialScene.id || initialScene.share_token || initialScene.project_name || 'scene'}`, [initialScene.id, initialScene.share_token, initialScene.project_name]);
  const [activeStep, setActiveStepValue] = useState(() => {
    if (typeof window === 'undefined') return 1;
    return window.localStorage.getItem(introStorageKey) === 'started' ? 2 : 1;
  });
  const markIntroStarted = () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(introStorageKey, 'started');
    } catch (_) {}
  };
  const setActiveStep = (nextStep) => {
    setActiveStepValue((currentStep) => {
      const resolvedStep = typeof nextStep === 'function' ? nextStep(currentStep) : nextStep;
      if (resolvedStep > 1) markIntroStarted();
      return resolvedStep;
    });
  };
  const [openOptions, setOpenOptions] = useState({ moquette: false, empreinte: false, coton: false, plancher: false, led: false, reserve: false, tete: false, comptoir: false });
  const [selectedCarpetId, setSelectedCarpetId] = useState(initialOptions.carpetColorId || initialOptions.defaultColorOptions?.carpetColorId || '');
  const [selectedCarpetFootprintId, setSelectedCarpetFootprintId] = useState(initialOptions.carpetFootprintColorId || initialOptions.defaultColorOptions?.carpetFootprintColorId || initialOptions.carpetColorId || initialOptions.defaultColorOptions?.carpetColorId || '');
  const [carpetConfigOptions, setCarpetConfigOptions] = useState(initialOptions.carpetConfigOptions || {});
  const [carpetThick, setCarpetThick] = useState(Boolean(initialOptions.carpetThick));
  const [footprintThick, setFootprintThick] = useState(Boolean(initialOptions.footprintThick));
  const [carpetFootprintEnabled, setCarpetFootprintEnabled] = useState(initialOptions.carpetFootprintEnabled !== false);
  const [selectedWallFabricId, setSelectedWallFabricId] = useState(initialOptions.wallFabricColorId || initialOptions.defaultColorOptions?.wallFabricColorId || '');
  const [technicalFloorType, setTechnicalFloorType] = useState(initialOptions.technicalFloorType || '');
  const [technicalFloorTrimType, setTechnicalFloorTrimType] = useState(initialOptions.technicalFloorTrimType || 'straight');
  const [technicalFloorRampX, setTechnicalFloorRampX] = useState(Number(initialOptions.technicalFloorRampX || 0));
  const [ledRailsEnabled, setLedRailsEnabled] = useState(initialOptions.ledRailsEnabled !== false);
  const [ledRailOverrides, setLedRailOverrides] = useState(initialOptions.ledRailOverrides || {});
  const [reserveItemOverrides, setReserveItemOverrides] = useState(initialOptions.reserveItemOverrides || {});
  const [reserveOptionType, setReserveOptionType] = useState(initialOptions.reserveOptionType || (initialOptions.reserveUpgradeEnabled ? '__legacy__' : ''));
  const [partitionHeadChoice, setPartitionHeadChoice] = useState({
    left: hasOwn(initialOptions, 'partitionHeadLeftEnabled') ? Boolean(initialOptions.partitionHeadLeftEnabled) : null,
    right: hasOwn(initialOptions, 'partitionHeadRightEnabled') ? Boolean(initialOptions.partitionHeadRightEnabled) : null,
  });
  const [partitionHeadVisuals, setPartitionHeadVisuals] = useState(initialOptions.partitionHeadVisuals || {});
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const [saveState, setSaveState] = useState(initialScene.client_status || 'not_started');
  const [confirmState, setConfirmState] = useState({ loading: false, message: '', error: '' });
  const [itemOptionState, setItemOptionState] = useState({ uploading: false, error: '' });
  const [wallCoverState, setWallCoverState] = useState({ uploading: '', error: '' });
  const [wallCovers, setWallCovers] = useState(initialOptions.wallCovers || {});
  const [itemConfigModal, setItemConfigModal] = useState(null);
  const [basePackOpen, setBasePackOpen] = useState(false);
  const [sceneHasRendered, setSceneHasRendered] = useState(false);
  const [clientInfo, setClientInfo] = useState({
    client: initialScene.client_name || '',
    project: initialScene.project_name || '',
    event: initialScene.event_name || initialScene.salon || '',
  });
  const [contactDetails, setContactDetails] = useState(() => ({
    firstName: savedContactDetail(initialScene, 'firstName') || mondayColumnText(initialScene.source_payload, 'texte2'),
    lastName: savedContactDetail(initialScene, 'lastName') || mondayColumnText(initialScene.source_payload, 'texte8'),
    company: savedContactDetail(initialScene, 'company') || sceneExhibitorCompanyName(initialScene, {}, {}) || '',
    role: savedContactDetail(initialScene, 'role'),
    email: savedContactDetail(initialScene, 'email') || initialScene.client_email || mondayColumnText(initialScene.source_payload, 'email'),
    phone: savedContactDetail(initialScene, 'phone') || mondayColumnText(initialScene.source_payload, 'telephone') || mondayColumnText(initialScene.source_payload, 'phone'),
    address: savedContactDetail(initialScene, 'address'),
    zip: savedContactDetail(initialScene, 'zip'),
    city: savedContactDetail(initialScene, 'city'),
    country: savedContactDetail(initialScene, 'country') || 'France',
    salon: savedContactDetail(initialScene, 'salon') || initialScene.salon || 'SMCL 2026',
    hall: savedContactDetail(initialScene, 'hall') || sceneHallLabel(initialScene, {}),
    emplacement: savedContactDetail(initialScene, 'emplacement') || sceneStandNumber(initialScene, {}, initialScene.project_name || 'Stand A-14'),
  }));
  const contactInitials = userInitials(contactDetails.firstName, contactDetails.lastName, contactDetails.company);
  const [questionCategory, setQuestionCategory] = useState('technical');
  const [urgency, setUrgency] = useState('important');
  const [questionForm, setQuestionForm] = useState({ subject: '', message: '' });
  const [objectBank, setObjectBank] = useState([]);
  const [objectBankLoaded, setObjectBankLoaded] = useState(false);
  const [viewAngle] = useState(35);
  const hasMounted = useRef(false);

  const area = width * depth;
  const salonLabel = initialScene.salon || clientInfo.event || 'SMCL 2026';
  const standLabel = initialScene.project_name || clientInfo.project || 'Stand A-14';
  const clientLabel = clientInfo.client || contactDetails.company || 'Aerosys Industries';
  const carpetPalette = useMemo(() => colorOptionsForUsage(objectBank, salonLabel, 'carpet', carpetColors), [objectBank, salonLabel]);
  const footprintPalette = useMemo(() => colorOptionsForUsage(objectBank, salonLabel, 'footprint', carpetPalette), [objectBank, salonLabel, carpetPalette]);
  const wallFabricPalette = useMemo(() => colorOptionsForUsage(objectBank, salonLabel, 'wallFabric', wallFabricColors), [objectBank, salonLabel]);
  const counterPalette = useMemo(() => colorOptionsForUsage(objectBank, salonLabel, 'counter', []), [objectBank, salonLabel]);
  const carpetGroupConfigOptionsList = useMemo(() => colorGroupConfigOptions(objectBank, salonLabel, 'carpet'), [objectBank, salonLabel]);
  const groupDefaultColorOptions = useMemo(() => makePaletteDefaultColorOptions({
    carpetPalette,
    footprintPalette,
    wallFabricPalette,
  }), [carpetPalette, footprintPalette, wallFabricPalette]);
  const presetDefaultColorOptions = useMemo(() => initialOptions.defaultColorOptions || defaultColorOptionsFromFlatOptions(initialOptions), [initialOptions]);
  const effectiveDefaultColorOptions = useMemo(() => ({
    ...groupDefaultColorOptions,
    ...presetDefaultColorOptions,
  }), [groupDefaultColorOptions, presetDefaultColorOptions]);
  const rawSelectedCarpetColor = findColorInPalette(carpetPalette, selectedCarpetId) || defaultColorFromPalette(carpetPalette) || carpetPalette[0] || carpetColors[0];
  const rawSelectedCarpetFootprintColor = findColorInPalette(footprintPalette, selectedCarpetFootprintId) || defaultColorFromPalette(footprintPalette) || rawSelectedCarpetColor;
  const rawSelectedWallFabricColor = findColorInPalette(wallFabricPalette, selectedWallFabricId) || defaultColorFromPalette(wallFabricPalette) || wallFabricPalette[0] || wallFabricColors[0];
  const rawReserveWallFabricColor = findColorInPalette(wallFabricPalette, effectiveDefaultColorOptions.reserveWallFabricColorId) || rawSelectedWallFabricColor;
  const selectedCarpetColor = colorWithDefaultIncluded(rawSelectedCarpetColor, effectiveDefaultColorOptions.carpetColorId);
  const selectedCarpetFootprintColor = colorWithDefaultIncluded(rawSelectedCarpetFootprintColor, effectiveDefaultColorOptions.carpetFootprintColorId || effectiveDefaultColorOptions.carpetColorId);
  const selectedWallFabricColor = colorWithDefaultIncluded(rawSelectedWallFabricColor, effectiveDefaultColorOptions.wallFabricColorId);
  const selectedReserveWallFabricColor = colorWithDefaultIncluded(rawReserveWallFabricColor, effectiveDefaultColorOptions.reserveWallFabricColorId || effectiveDefaultColorOptions.wallFabricColorId);
  const selectedTechnicalFloor = technicalFloorOptions.find((option) => option.id === technicalFloorType) || null;
  const effectiveCarpetFootprintEnabled = carpetFootprintEnabled && !selectedTechnicalFloor;
  const faceLabel = layout === 'u' ? '3 faces ouvertes' : layout === 'back' ? '1 face ouverte' : '2 faces ouvertes';
  const selectedLanguage = languages.find((entry) => entry.id === language) || languages[0];
  const readOnly = false;
  const sceneVisualContext = useMemo(() => ({
    fontRevision,
    language,
    company: sceneExhibitorCompanyName(initialScene, clientInfo, contactDetails),
    standNumber: sceneStandNumber(initialScene, contactDetails, standLabel),
    aisleNumber: sceneAisleNumber(initialScene, contactDetails),
    hall: sceneHallLabel(initialScene, contactDetails),
    sector: sceneSectorLabel(initialScene),
  }), [fontRevision, language, initialScene, clientInfo, contactDetails, standLabel]);

  useEffect(() => {
    let cancelled = false;
    if (typeof document === 'undefined' || !document.fonts?.load) return undefined;
    Promise.all([
      document.fonts.load('200 125px Oswald'),
      document.fonts.load('300 54px Oswald'),
      document.fonts.load('400 92px Oswald'),
      document.fonts.load('500 92px Oswald'),
      document.fonts.load('700 92px Oswald'),
    ]).then(() => {
      if (!cancelled) setFontRevision((current) => current + 1);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setItems((current) => current.map((item) => constrainItem(item, width, depth, layout, effectiveCarpetFootprintEnabled)));
  }, [width, depth, layout, effectiveCarpetFootprintEnabled]);

  useEffect(() => {
    if (!selectedTechnicalFloor) return;
    setTechnicalFloorRampX((current) => clamp(Number(current || 0), -width / 2, width / 2));
  }, [selectedTechnicalFloor, width]);

  useEffect(() => {
    if (readOnly) {
      setDraggingId(null);
      setSelectedId(null);
      setRotationPanelOpen(false);
      setItemConfigModal(null);
    }
  }, [readOnly]);

  useEffect(() => {
    setItemOptionState({ uploading: false, error: '' });
  }, [selectedId]);

  const availableCatalog = useMemo(() => {
    const dynamicEntries = objectBank
      .filter((asset) => asset.is_active)
      .filter((asset) => !asset.dimensions?.isColorGroup)
      .filter((asset) => assetMatchesSalon(asset, salonLabel))
      .map((asset) => assetToCatalogEntry(asset, objectBank))
      .filter(Boolean);
    const entries = [...dynamicEntries, ...nativeCatalogEntries()];
    return uniqueCatalogEntries(entries);
  }, [objectBank, salonLabel]);
  const placeableCatalog = useMemo(
    () => availableCatalog.filter((entry) => isAdminViewer || !entry.dimensions?.adminOnly),
    [availableCatalog, isAdminViewer],
  );
  const hydratedItems = useMemo(() => (
    objectBankLoaded ? items.map((item) => hydrateSceneItemFromCatalog(item, availableCatalog)) : items
  ), [items, availableCatalog, objectBankLoaded]);
  const manualHydratedItems = useMemo(() => hydratedItems.filter((item) => !isAutomaticLedRailItem(item) && !isAutomaticReserveItem(item) && !isAutomaticPartitionHeadItem(item)), [hydratedItems]);
  const ledRailEntries = useMemo(() => ledRailCatalogEntries(availableCatalog), [availableCatalog]);
  const ledSpotCount = ledSpotCountForArea(area);
  const reserveRules = useMemo(() => sceneReserveRules(initialScene), [initialScene]);
  const activeReserveRuleConfig = useMemo(() => activeReserveRule(reserveRules, area), [reserveRules, area]);
  const effectiveReserveOptionType = reserveOptionType === '__legacy__' ? normalizeComplementaryOptions(activeReserveRuleConfig?.options)[0]?.type || '' : reserveOptionType;
  const partitionHeadRules = useMemo(() => scenePartitionHeadRules(initialScene), [initialScene]);
  const activePartitionHeadRuleConfig = useMemo(() => activePartitionHeadRule(partitionHeadRules, area, layout), [partitionHeadRules, area, layout]);
  const effectivePartitionHeadSides = useMemo(() => partitionHeadEnabledSides(activePartitionHeadRuleConfig, partitionHeadChoice), [activePartitionHeadRuleConfig, partitionHeadChoice]);
  const automaticReserveItems = useMemo(
    () => makeAutomaticReserveItems(activeReserveRuleConfig, effectiveReserveOptionType, availableCatalog, width, depth, layout, salonLabel)
      .map((item) => applyReserveItemOverride(item, reserveItemOverrides, width, depth, layout, effectiveCarpetFootprintEnabled)),
    [activeReserveRuleConfig, effectiveReserveOptionType, availableCatalog, width, depth, layout, salonLabel, reserveItemOverrides, effectiveCarpetFootprintEnabled],
  );
  const automaticPartitionHeadItems = useMemo(
    () => makeAutomaticPartitionHeadItems(activePartitionHeadRuleConfig, effectivePartitionHeadSides, availableCatalog, width, depth, layout, salonLabel)
      .map((item) => applyPartitionHeadVisualOptions(item, partitionHeadVisuals)),
    [activePartitionHeadRuleConfig, effectivePartitionHeadSides, availableCatalog, width, depth, layout, salonLabel, partitionHeadVisuals],
  );
  const autoSpotsRule = useMemo(() => initialOptions.autoSpotsRule || null, [initialOptions]);
  const automaticLedItems = useMemo(
    () => (ledRailsEnabled && !autoSpotsRule?.type
      ? makeAutomaticLedRailItems(ledRailEntries, width, depth, layout, ledSpotCount)
        .map((item) => applyLedRailOverride(item, ledRailOverrides, width, depth, layout))
      : []),
    [ledRailsEnabled, ledRailEntries, autoSpotsRule, width, depth, layout, ledSpotCount, ledRailOverrides],
  );
  const automaticSpotItems = useMemo(
    () => makeAutomaticSpotItems(autoSpotsRule, availableCatalog, width, depth, layout, automaticReserveItems)
      .map((item) => applyLedRailOverride(item, ledRailOverrides, width, depth, layout)),
    [autoSpotsRule, availableCatalog, width, depth, layout, automaticReserveItems, ledRailOverrides],
  );
  const wallCoverSurfaces = useMemo(
    () => wallCoverSurfaceOptions(layout, width, depth, [...manualHydratedItems, ...automaticReserveItems, ...automaticPartitionHeadItems]),
    [layout, width, depth, manualHydratedItems, automaticReserveItems, automaticPartitionHeadItems],
  );
  const sceneItems = useMemo(() => [...manualHydratedItems, ...automaticReserveItems, ...automaticPartitionHeadItems, ...automaticLedItems, ...automaticSpotItems], [manualHydratedItems, automaticReserveItems, automaticPartitionHeadItems, automaticLedItems, automaticSpotItems]);
  const includedCounterItems = useMemo(() => sceneItems.filter((item) => isWoodReceptionDeskItem(item) && isIncludedSceneItem(item)), [sceneItems]);
  const cartItems = useMemo(() => sceneItems.filter(shopCartItemVisible), [sceneItems]);
  const showCartBar = !readOnly && (activeStep === 2 || activeStep === 3);
  const wallCoverImageUrls = useMemo(() => Object.values(wallCovers || {}).map((cover) => cover?.imageUrl).filter(Boolean), [wallCovers]);
  const sceneTextureLoad = useSceneTexturePreload(sceneItems, [
    selectedCarpetColor.image,
    effectiveCarpetFootprintEnabled ? selectedCarpetFootprintColor.image : '',
    selectedWallFabricColor.image,
    selectedReserveWallFabricColor.image,
    ...wallCoverImageUrls,
  ]);
  const sceneSuspendLoad = useSceneSuspendPreload(objectBankLoaded ? sceneItems : []);
  const sceneAssetsReady = objectBankLoaded && sceneTextureLoad.ready && sceneSuspendLoad.ready;
  const shouldRenderScene = sceneAssetsReady || sceneHasRendered;
  const sceneLoadProgress = combineLoadStates(
    objectBankLoaded ? sceneTextureLoad : { loaded: 0, total: 1 },
    objectBankLoaded ? sceneSuspendLoad : { loaded: 0, total: 1 },
  );
  const sceneCanvasClassName = [
    (draggingId || technicalFloorRampDragging) ? 'dragging-canvas' : '',
    !sceneHasRendered && !sceneAssetsReady ? 'scene-canvas-loading' : '',
  ].filter(Boolean).join(' ');
  const selected = sceneItems.find((item) => item.id === selectedId);

  useEffect(() => {
    setSceneHasRendered(false);
  }, [initialScene?.id]);

  useEffect(() => {
    if (sceneAssetsReady) setSceneHasRendered(true);
  }, [sceneAssetsReady]);

  useEffect(() => {
    if (!objectBank.length) return;
    setItems((current) => current.map((item) => hydrateSceneItemFromCatalog(item, availableCatalog)));
  }, [objectBank, availableCatalog]);

  const scenePricing = useMemo(() => calculateScenePricing({
    area,
    catalog: availableCatalog,
    items: sceneItems,
    salonLabel,
    scene: initialScene,
    width,
    depth,
    layout,
    technicalFloor: selectedTechnicalFloor ? { ...selectedTechnicalFloor, area } : null,
    colorSelections: [
      { usage: 'Moquette', color: selectedCarpetColor, defaultColorId: effectiveDefaultColorOptions.carpetColorId, quantityM2: area, configOptions: [...carpetGroupConfigOptionsList, { id: '__carpet-thick__', label: 'Moquette épaisse', pricePerM2: 30 }], selectedConfigOptions: { ...carpetConfigOptions, '__carpet-thick__': carpetThick } },
      effectiveCarpetFootprintEnabled ? { usage: 'Empreinte moquette', color: selectedCarpetFootprintColor, defaultColorId: effectiveDefaultColorOptions.carpetFootprintColorId || effectiveDefaultColorOptions.carpetColorId, quantityM2: carpetFootprintAreaM2(), configOptions: [{ id: '__footprint-thick__', label: 'Moquette épaisse', pricePerM2: 30 }], selectedConfigOptions: { '__footprint-thick__': footprintThick } } : null,
      { usage: 'Coton cloison', color: selectedWallFabricColor, defaultColorId: effectiveDefaultColorOptions.wallFabricColorId, quantityM2: sceneWallFabricArea(width, depth, layout) },
    ],
    wallCovers,
    wallCoverSurfaces,
  }), [area, availableCatalog, sceneItems, salonLabel, initialScene, width, depth, layout, selectedTechnicalFloor, selectedCarpetColor, selectedCarpetFootprintColor, effectiveCarpetFootprintEnabled, selectedWallFabricColor, effectiveDefaultColorOptions, wallCovers, wallCoverSurfaces, carpetGroupConfigOptionsList, carpetConfigOptions, carpetThick, footprintThick]);
  const estimatedTotal = scenePricing.total;

  const currentScenePayload = (status, clientStatus, overrides = {}) => {
    const nextContactDetails = overrides.contactDetails || contactDetails;
    const nextClientInfo = overrides.clientInfo || clientInfo;
    const options = {
      carpetColorId: selectedCarpetColor.id,
      carpetColorName: selectedCarpetColor.name,
      carpetColorHex: selectedCarpetColor.hex,
      carpetColorPrice: Number(selectedCarpetColor.price || 0),
      carpetColorReference: selectedCarpetColor.reference || '',
      carpetFootprintColorId: selectedCarpetFootprintColor.id,
      carpetFootprintColorName: selectedCarpetFootprintColor.name,
      carpetFootprintColorHex: selectedCarpetFootprintColor.hex,
      carpetFootprintColorPrice: Number(selectedCarpetFootprintColor.price || 0),
      carpetFootprintColorReference: selectedCarpetFootprintColor.reference || '',
      carpetFootprintEnabled: effectiveCarpetFootprintEnabled,
      carpetConfigOptions: Object.keys(carpetConfigOptions).length ? carpetConfigOptions : undefined,
      carpetThick: carpetThick || undefined,
      footprintThick: footprintThick || undefined,
      defaultColorOptions: effectiveDefaultColorOptions,
      wallFabricColorId: selectedWallFabricColor.id,
      wallFabricColorName: selectedWallFabricColor.name,
      wallFabricColorHex: selectedWallFabricColor.hex,
      wallFabricColorPrice: Number(selectedWallFabricColor.price || 0),
      wallFabricColorReference: selectedWallFabricColor.reference || '',
      reserveWallFabricColorId: selectedReserveWallFabricColor.id,
      reserveWallFabricColorName: selectedReserveWallFabricColor.name,
      reserveWallFabricColorHex: selectedReserveWallFabricColor.hex,
      reserveWallFabricColorPrice: Number(selectedReserveWallFabricColor.price || 0),
      reserveWallFabricColorReference: selectedReserveWallFabricColor.reference || '',
      wallCovers,
      technicalFloorType,
      technicalFloorLabel: selectedTechnicalFloor?.label || '',
      technicalFloorHeight: selectedTechnicalFloor?.height || 0,
      technicalFloorPrice: selectedTechnicalFloor?.price || 0,
      technicalFloorReference: selectedTechnicalFloor?.reference || '',
      technicalFloorTrimType,
      technicalFloorRampEnabled: Boolean(selectedTechnicalFloor),
      technicalFloorRampX,
      language,
      ledRailsEnabled,
      autoSpotsRule,
      ledSpotCount,
      ledRailOverrides,
      reserveOptionType: effectiveReserveOptionType,
      reserveItemOverrides,
      partitionHeadLeftEnabled: effectivePartitionHeadSides.left,
      partitionHeadRightEnabled: effectivePartitionHeadSides.right,
      partitionHeadVisuals,
    };

    return {
      ...initialScene,
      status,
      client_status: clientStatus,
      client_name: nextClientInfo.client,
      client_email: nextContactDetails.email || initialScene.client_email,
      project_name: nextClientInfo.project,
      event_name: nextClientInfo.event,
      dimensions: { width, depth, height },
      layout,
      items: manualHydratedItems,
      options,
      source_payload: {
        ...(initialScene.source_payload || {}),
        contactDetails: nextContactDetails,
        options,
          pricing: {
            basePrice: scenePricing.basePrice,
            baseItems: scenePricing.baseItems,
            baseUsage: scenePricing.baseUsage,
            baseItemsConfigured: scenePricing.baseItemsConfigured,
            itemsTotal: scenePricing.itemsTotal,
            total: scenePricing.total,
            lines: scenePricing.lines,
        },
      },
    };
  };

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return undefined;
    }

    if (readOnly) return undefined;

    const timer = window.setTimeout(() => {
      const alreadyConfigured = saveState === 'configured';
      saveScene(currentScenePayload(alreadyConfigured ? 'configured' : 'created', alreadyConfigured ? 'configured' : 'draft'))
        .then(() => {
          if (!alreadyConfigured) setSaveState('draft');
        })
        .catch((error) => console.error('Scene save failed', error));
    }, 800);

    return () => window.clearTimeout(timer);
  }, [width, depth, height, layout, manualHydratedItems, clientInfo, selectedCarpetColor, selectedCarpetFootprintColor, effectiveCarpetFootprintEnabled, selectedWallFabricColor, selectedReserveWallFabricColor, wallCovers, technicalFloorType, technicalFloorTrimType, selectedTechnicalFloor, technicalFloorRampX, language, ledRailsEnabled, ledSpotCount, ledRailOverrides, reserveItemOverrides, effectiveReserveOptionType, effectivePartitionHeadSides, partitionHeadVisuals, saveState, readOnly]);

  useEffect(() => {
    listObjectBank()
      .then((assets) => setObjectBank(assets || []))
      .catch((error) => console.error('Object bank load failed', error))
      .finally(() => setObjectBankLoaded(true));
  }, []);

  const validateConfiguration = async () => {
    if (confirmState.loading) return;
    setConfirmState({ loading: true, message: '', error: '' });
    try {
      await saveScene(currentScenePayload('configured', 'configured'));
      setSaveState('configured');
      setDraggingId(null);
      setActiveStep(4);
      setConfirmState({ loading: false, message: 'Votre scène est confirmée. Vous pouvez encore la modifier si besoin.', error: '' });
    } catch (error) {
      setConfirmState({ loading: false, message: '', error: error.message || 'Confirmation impossible.' });
    }
  };

  const toggleOption = (key) => {
    setOpenOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleTechnicalFloorType = (type) => {
    setTechnicalFloorType(type);
    if (type) {
      setCarpetFootprintEnabled(false);
      setTechnicalFloorRampX((current) => clamp(Number(current || 0), -width / 2, width / 2));
    }
  };

  const updateItem = (id, patch) => {
    if (readOnly) return;
    const currentItem = sceneItems.find((item) => item.id === id);
    if (!isAdminViewer && hasOwn(patch, 'rotation') && itemRotationLocked(currentItem)) return;
    const autoLedItem = sceneItems.find((item) => item.id === id && isAutomaticLedRailItem(item));
    if (autoLedItem) {
      const constrained = constrainItem({ ...autoLedItem, ...patch }, width, depth, layout, effectiveCarpetFootprintEnabled);
      setLedRailOverrides((current) => ({
        ...current,
        [id]: pickLedRailOverride(constrained),
      }));
      return;
    }
    const autoReserveItem = sceneItems.find((item) => item.id === id && isAutomaticReserveItem(item));
    if (autoReserveItem) {
      const editableItem = releasePlacementRuleForManualEdit(autoReserveItem, patch);
      const blockers = [...manualHydratedItems, ...automaticPartitionHeadItems, ...automaticLedItems, ...automaticSpotItems].filter((item) => item.id !== id);
      const updated = updateSceneItemWithCollision([editableItem, ...blockers], id, patch, width, depth, layout, effectiveCarpetFootprintEnabled);
      const constrained = updated.find((item) => item.id === id);
      if (!constrained || constrained === editableItem) return;
      setReserveItemOverrides((current) => ({
        ...current,
        [id]: pickReserveItemOverride(constrained),
      }));
      return;
    }
    setItems((current) => {
      const blockers = [...automaticReserveItems, ...automaticPartitionHeadItems].filter((item) => item.id !== id);
      const updated = updateSceneItemWithCollision([...current, ...blockers], id, patch, width, depth, layout, effectiveCarpetFootprintEnabled);
      return updated.filter((item) => !isAutomaticReserveItem(item));
    });
  };

  const updateItemOptions = (targetItem, patch) => {
    if (!targetItem || readOnly) return;
    if (isAutomaticPartitionHeadItem(targetItem)) {
      const side = targetItem.options?.partitionHeadSide || smclPartitionHeadSide(targetItem);
      if (side) {
        setPartitionHeadVisuals((current) => ({
          ...current,
          [side]: { ...(current?.[side] || {}), ...patch },
        }));
      }
      return;
    }
    updateItem(targetItem.id, { options: { ...(targetItem.options || {}), ...patch } });
  };

  const updateIncludedCounterVariant = (targetItem, variantEntry, patch = {}) => {
    if (!targetItem || !variantEntry || readOnly) return;
    replaceItemWithEntry(targetItem, variantEntry, { ...(targetItem.options || {}), ...patch });
  };

  const uploadItemImage = async (targetItem, file, optionKeys = {}) => {
    if (!targetItem || !file) return;
    const urlKey = optionKeys.urlKey || 'headMainImageUrl';
    const nameKey = optionKeys.nameKey || 'headMainImageName';
    setItemOptionState({ uploading: true, error: '' });
    try {
      const imageUrl = await uploadSceneItemOptionImage(initialScene, targetItem, file);
      updateItemOptions(targetItem, { [urlKey]: imageUrl, [nameKey]: file.name });
      setItemOptionState({ uploading: false, error: '' });
    } catch (error) {
      setItemOptionState({ uploading: false, error: error.message || 'Upload impossible.' });
    }
  };

  const toggleWallCover = (surfaceId, enabled) => {
    if (readOnly) return;
    setWallCovers((current) => ({
      ...current,
      [surfaceId]: { ...(current?.[surfaceId] || {}), enabled },
    }));
  };

  const uploadWallCoverImage = async (surfaceId, file) => {
    if (!surfaceId || !file || readOnly) return;
    setWallCoverState({ uploading: surfaceId, error: '' });
    try {
      const uploadedUrl = await uploadSceneItemOptionImage(initialScene, { id: `wall-cover-${surfaceId}`, type: 'wall-cover' }, file);
      const imageUrl = cacheBustedUrl(uploadedUrl);
      await preloadImage(imageUrl);
      setWallCovers((current) => ({
        ...current,
        [surfaceId]: { ...(current?.[surfaceId] || {}), enabled: true, imageUrl, imageName: file.name },
      }));
      setWallCoverState({ uploading: '', error: '' });
    } catch (error) {
      setWallCoverState({ uploading: '', error: error.message || 'Upload impossible.' });
    }
  };


  const uploadPartitionHeadVisual = async (side, file) => {
    if (!side || !file || readOnly) return;
    setItemOptionState({ uploading: side, error: '' });
    try {
      const uploadedUrl = await uploadSceneItemOptionImage(initialScene, { id: `partition-head-${side}`, type: 'partition-head' }, file);
      const imageUrl = cacheBustedUrl(uploadedUrl);
      await preloadImage(imageUrl);
      setPartitionHeadVisuals((current) => ({
        ...current,
        [side]: { ...(current?.[side] || {}), headMainImageUrl: imageUrl, headMainImageName: file.name },
      }));
      setItemOptionState({ uploading: '', error: '' });
    } catch (error) {
      setItemOptionState({ uploading: '', error: error.message || 'Upload impossible.' });
    }
  };

  const resetPartitionHeadVisual = (side) => {
    if (!side || readOnly) return;
    setPartitionHeadVisuals((current) => ({
      ...current,
      [side]: { ...(current?.[side] || {}), headMainImageUrl: '', headMainImageName: '' },
    }));
  };
  const openAddItemConfigurator = (entry) => {
    if (readOnly) return;
    if (entryNeedsConfigurator(entry)) {
      setItemConfigModal({ mode: 'add', entry });
    } else {
      addItem(entry, {}, 1);
    }
  };

  const itemConfiguratorEntry = (item) => (item?.options?.variantGroupType
    ? findCatalogEntry(availableCatalog, item.options.variantGroupType)
    : findCatalogEntry(availableCatalog, item?.type));

  const openSelectedItemConfigurator = () => {
    if (!selected || readOnly) return;
    setItemConfigModal({ mode: 'edit', item: selected, entry: itemConfiguratorEntry(selected) });
  };

  const closeItemConfigurator = () => setItemConfigModal(null);

  const confirmItemConfigurator = ({ entry, item, options, quantity = 1 }) => {
    if (readOnly) return;
    if (item) {
      if (entry?.type && entry.type !== item.type) {
        replaceItemWithEntry(item, entry, options);
      } else {
        updateItem(item.id, { options });
      }
      setItemConfigModal(null);
      return;
    }
    addItem(entry, options, quantity);
    setItemConfigModal(null);
  };

  const replaceItemWithEntry = (item, entry, options = {}) => {
    setItems((current) => {
      const nextBase = {
        ...makeItem(entry.type, width, depth, layout, entry),
        id: item.id,
        options,
        included: item.included,
        priceMode: item.priceMode,
        price_mode: item.price_mode,
        basePresetId: item.basePresetId,
        presetAnchor: item.presetAnchor,
        presetReferenceSize: item.presetReferenceSize,
      };
      const samePlacementMode = isWallItem(item) === isWallItem(nextBase);
      const compatiblePosition = samePlacementMode
        ? {
          ...(isWallItem(nextBase)
            ? { wall: item.wall, x: item.x, y: isTelevisionItem(nextBase) ? screenCenterHeight : item.y, z: item.z }
            : { x: item.x, z: item.z }),
          ...((isAdminViewer || !itemRotationLocked(nextBase)) ? { rotation: item.rotation } : {}),
        }
        : {};
      const candidate = constrainItem({ ...nextBase, ...compatiblePosition }, width, depth, layout, effectiveCarpetFootprintEnabled);
      const others = current.filter((sceneItem) => sceneItem.id !== item.id);
      const blockers = [...others, ...automaticReserveItems, ...automaticPartitionHeadItems];
      const placed = collidesWithScene(candidate, blockers, candidate.id, width, depth)
        ? placeItemInFreeSpot(candidate, blockers, width, depth, layout, effectiveCarpetFootprintEnabled)
        : candidate;
      if (!placed) return current;
      return [...others, placed];
    });
  };

  const moveDraggedItem = (point) => {
    if (readOnly || !draggingId) return;
    const dragged = sceneItems.find((item) => item.id === draggingId);
    if (!dragged) return;
    if (!isAdminViewer && itemMovementLocked(dragged)) return;

    if (isWallItem(dragged)) {
      updateItem(draggingId, wallDragPatch(point, dragged, sceneItems, width, depth, layout));
      return;
    }

    updateItem(draggingId, { x: point.x, z: point.z });
  };

  const addItem = (entry, options = {}, quantity = 1) => {
    if (readOnly) return;
    let lastPlacedId = null;
    const safeQuantity = Math.max(1, Number(quantity || 1));
    setItems((current) => {
      let next = current;
      for (let index = 0; index < safeQuantity; index += 1) {
        const item = {
          ...makeItem(entry.type, width, depth, layout, entry),
          options: { ...(options || {}) },
        };
        const placed = placeItemInFreeSpot(item, [...next, ...automaticReserveItems, ...automaticPartitionHeadItems], width, depth, layout, effectiveCarpetFootprintEnabled);
        if (!placed) break;
        lastPlacedId = placed.id;
        next = [...next, placed];
      }
      return next;
    });
    window.setTimeout(() => {
      if (lastPlacedId) setSelectedId(lastPlacedId);
    }, 0);
  };

  const removeOptionalItem = (type) => {
    if (readOnly) return;
    setItems((current) => {
      const index = [...current].reverse().findIndex((item) => item.type === type && !isIncludedSceneItem(item) && (isAdminViewer || !itemDeletionLocked(item)));
      if (index < 0) return current;
      const removeIndex = current.length - 1 - index;
      const removedItem = current[removeIndex];
      if (selectedId === removedItem.id) setSelectedId(null);
      return current.filter((_, itemIndex) => itemIndex !== removeIndex);
    });
  };

  const chooseLayout = (nextLayout) => {
    if (readOnly) return;
    setLayout(nextLayout);
    setItems((current) => current.map((item) => constrainItem(item, width, depth, nextLayout, effectiveCarpetFootprintEnabled)));
  };

  const removeReserve = () => {
    setReserveOptionType('__none__');
    if (activeReserveRuleConfig?.id) {
      const reservePrefix = `auto-reserve-${activeReserveRuleConfig.id}`;
      setItems((current) => current.filter((item) => {
        if (!isObjectWallId(item.wall)) return true;
        return !item.wall.includes(reservePrefix);
      }));
    }
  };

  const deleteSelectedItem = () => {
    if (readOnly || !selected) return;
    if (!isAdminViewer && itemDeletionLocked(selected)) return;
    if (isAutomaticLedRailItem(selected)) {
      setLedRailsEnabled(false);
      setSelectedId(null);
      return;
    }
    if (isAutomaticReserveItem(selected)) {
      removeReserve();
      setSelectedId(null);
      return;
    }
    if (isAutomaticPartitionHeadItem(selected)) {
      const side = selected.options?.partitionHeadSide;
      if (side) setPartitionHeadChoice((current) => ({ ...current, [side]: false }));
      setSelectedId(null);
      return;
    }
    setItems((current) => current.filter((item) => item.id !== selected.id));
    setSelectedId(null);
  };

  const updateClientInfo = (key, value) => {
    setClientInfo((current) => ({ ...current, [key]: value }));
  };

  const updateContactDetail = (key, value) => {
    setContactDetails((current) => ({ ...current, [key]: value }));
  };

  const toggleHeaderPanel = (panel) => {
    setHeaderPanel((current) => (current === panel ? null : panel));
  };

  const validateContactDetails = async () => {
    const nextClientInfo = {
      client: contactDetails.company,
      project: `Stand ${contactDetails.emplacement}`,
      event: contactDetails.salon,
    };
    const nextStatus = saveState === 'configured' ? 'configured' : 'created';
    const nextClientStatus = saveState === 'configured' ? 'configured' : 'draft';
    setClientInfo(nextClientInfo);
    try {
      await saveScene(currentScenePayload(nextStatus, nextClientStatus, { clientInfo: nextClientInfo, contactDetails }));
      await syncSceneContactToMonday(initialScene, contactDetails);
      if (saveState !== 'configured') setSaveState('draft');
    } catch (error) {
      console.error('Contact details sync failed', error);
    }
    setHeaderPanel(null);
  };

  const submitQuestion = (event) => {
    event.preventDefault();
    setQuestionForm({ subject: '', message: '' });
    setHeaderPanel(null);
  };

  if (!objectBankLoaded) return <div className="loading-screen">{tRaw(language, 'loading_objects')}</div>;

  return (
    <LanguageContext.Provider value={language}>
    <main className={`configurator-shell ${activeStep === 1 ? 'intro-step' : ''} ${showCartBar ? 'has-cart-bar' : ''} ${readOnly ? 'readonly-mode' : ''}`}>
      <header className="configurator-topbar">
        <a className="config-logo" href="/">
          <img src="/images/logo.png" alt="Stand-ING" />
        </a>
        <div className="config-breadcrumb">
          <span>{salonLabel}</span>
          <span>{standLabel}</span>
          <span>{area.toFixed(0)} m²</span>
        </div>
        <nav className="stepper" aria-label={tRaw(language, 'step_home')}>
          {[
            { id: 1, key: 'step_home' },
            { id: 2, key: 'step_options' },
            { id: 3, key: 'step_furniture' },
            { id: 4, key: 'step_validation' },
          ].map((step) => (
            <button key={step.id} className={activeStep === step.id ? 'active' : step.id < activeStep ? 'done' : ''} onClick={() => setActiveStep(step.id)}>
              <span>{step.id < activeStep ? <Check size={13} /> : step.id}</span>
              {tRaw(language, step.key)}
            </button>
          ))}
        </nav>
        <div className="top-estimate">
          <strong>{estimatedTotal.toLocaleString('fr-FR')} € HT</strong>
          <span>{tRaw(language, 'total_ht_estimated')}</span>
        </div>
        <button className={`round-tool ${headerPanel === 'question' ? 'active' : ''}`} type="button" onClick={() => toggleHeaderPanel('question')} aria-label={tRaw(language, 'aria_questions')}>
          <HelpCircle size={18} />
        </button>
        <button className={`language-pill ${headerPanel === 'language' ? 'active' : ''}`} type="button" onClick={() => toggleHeaderPanel('language')} aria-label={tRaw(language, 'aria_language')}>
          <span className="flag-dot">{selectedLanguage.flag}</span>
          {selectedLanguage.short}
          <ChevronDown size={15} />
        </button>
        <button className={`user-pill ${headerPanel === 'client' ? 'active' : ''}`} type="button" onClick={() => toggleHeaderPanel('client')} aria-label={tRaw(language, 'aria_client')}>{contactInitials}</button>
      </header>

      {headerPanel === 'client' && (
        <div className="header-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && setHeaderPanel(null)}>
          <ClientInfoModal
            salonLabel={salonLabel}
            contactDetails={contactDetails}
            onChange={updateContactDetail}
            onClose={() => setHeaderPanel(null)}
            onValidate={validateContactDetails}
          />
        </div>
      )}

      {headerPanel === 'question' && (
        <div className="header-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && setHeaderPanel(null)}>
          <QuestionModal
            salonLabel={salonLabel}
            form={questionForm}
            onFormChange={(key, value) => setQuestionForm((current) => ({ ...current, [key]: value }))}
            onClose={() => setHeaderPanel(null)}
            onSubmit={submitQuestion}
          />
        </div>
      )}

      {headerPanel === 'language' && (
        <div className="header-popover-layer" onMouseDown={() => setHeaderPanel(null)}>
          <LanguageMenu
            language={language}
            onSelect={(nextLanguage) => {
              setLanguage(nextLanguage);
              setHeaderPanel(null);
            }}
          />
        </div>
      )}

      <section className="configurator-stage">
        <Canvas
          camera={{ position: [4.5, 4.2, 5.7], fov: 48 }}
          dpr={[1, 1.5]}
          className={sceneCanvasClassName}
          shadows
          onPointerUp={() => {
            if (!readOnly) setDraggingId(null);
          }}
          onPointerLeave={() => {
            if (!readOnly) {
              setDraggingId(null);
            }
          }}
        >
          <color attach="background" args={['#eef0f4']} />
          <ambientLight intensity={1.05} />
          <directionalLight position={[3, 7, 4]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center>Chargement</Html>}>
            {shouldRenderScene && (
              <StandScene
                width={width}
                depth={depth}
                height={height}
                layout={layout}
                items={sceneItems}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                draggingId={draggingId}
                setDraggingId={setDraggingId}
                interactive={!readOnly}
                hoverEnabled={!orbitControlsActive}
                canEditLockedItems={isAdminViewer}
                onDragMove={moveDraggedItem}
                viewAngle={viewAngle}
                carpetColor={selectedCarpetColor}
                carpetFootprintColor={selectedCarpetFootprintColor}
                carpetFootprintEnabled={effectiveCarpetFootprintEnabled}
                wallFabricColor={selectedWallFabricColor}
                reserveWallFabricColor={selectedReserveWallFabricColor}
                wallCovers={wallCovers}
                technicalFloor={selectedTechnicalFloor}
                technicalFloorTrimType={technicalFloorTrimType}
                technicalFloorRampX={technicalFloorRampX}
                onTechnicalFloorRampX={setTechnicalFloorRampX}
                onTechnicalFloorRampDragChange={setTechnicalFloorRampDragging}
                visualContext={sceneVisualContext}
              />
            )}
            <ContactShadows opacity={0.12} scale={12} blur={2.8} far={5} position={[0, -0.01, 0]} />
          </Suspense>
          <OrbitControls
            makeDefault
            target={[0, 0.7, 0]}
            minPolarAngle={Math.PI / 5.2}
            maxPolarAngle={Math.PI / 2.25}
            minDistance={4}
            maxDistance={11}
            enablePan
            enabled={!draggingId && !technicalFloorRampDragging}
            onStart={() => setOrbitControlsActive(true)}
            onEnd={() => setOrbitControlsActive(false)}
          />
        </Canvas>

        {!sceneHasRendered && !sceneAssetsReady && <SceneTextureLoaderOverlay loaded={sceneLoadProgress.loaded} total={sceneLoadProgress.total} />}

        {readOnly && !headerPanel && (
          <div className="readonly-badge">
            <Check size={15} /> {tRaw(language, 'scene_confirmed_badge')}
          </div>
        )}

        {activeStep > 1 && !headerPanel && scenePricing.baseUsage?.length > 0 && (
          <div className="base-pack-scene-note">
            <button type="button" onClick={() => setBasePackOpen((open) => !open)} aria-expanded={basePackOpen}>
              <strong>{tRaw(language, 'base_pack')}</strong>
              <span>{scenePricing.baseUsage.length} quota{scenePricing.baseUsage.length > 1 ? 's' : ''}</span>
              {basePackOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {basePackOpen && (
              <div className="base-pack-scene-list">
                {scenePricing.baseUsage.map((item) => (
                  <span key={item.type}>{basePackItemLabel(item.label, item.quantity)} {basePackIncludedWord(item.label, item.quantity)} {item.used}/{item.quantity}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {activeStep === 1 && !headerPanel && !readOnly && (
          <div className="intro-overlay">
            <article className="intro-card" aria-label={tRaw(language, 'step_home')}>
              <div className="intro-card-head">
                <h1>{tRaw(language, 'intro_title')}</h1>
                <span>{salonLabel} · {standLabel}</span>
              </div>
              <div className="intro-card-body">
                <p>{tRaw(language, 'intro_subtitle')}</p>
                <ul>
                  <li><span>🏛</span>{standLabel} · Hall 1 · {faceLabel}</li>
                  <li><span>📐</span>{area.toFixed(0)} m²</li>
                  <li><span>📅</span>{salonLabel}</li>
                </ul>
                <button type="button" onClick={() => setActiveStep(2)}>
                  {tRaw(language, 'intro_start')}
                </button>
              </div>
            </article>
          </div>
        )}

        {selected && !readOnly && (
          <div className="view-toolbar selection-mode" aria-label="Actions objet selectionne">
            <button type="button" disabled={!isAdminViewer && itemRotationLocked(selected)} onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
            <button type="button" disabled={isAutomaticReserveItem(selected)} onClick={openSelectedItemConfigurator} title={tRaw(language, 'toolbar_settings')}><Settings2 size={16} /></button>
            <button type="button" disabled={!isAdminViewer && itemDeletionLocked(selected)} onClick={deleteSelectedItem} title={tRaw(language, 'toolbar_delete')}><Trash2 size={16} /></button>
            {!isAdminViewer && itemMovementLocked(selected) && <span className="toolbar-lock-note">{tRaw(language, 'toolbar_locked_move')}</span>}
            {!isAdminViewer && itemRotationLocked(selected) && <span className="toolbar-lock-note">{tRaw(language, 'toolbar_locked_rotation')}</span>}
            {!isAdminViewer && itemDeletionLocked(selected) && <span className="toolbar-lock-note">{tRaw(language, 'toolbar_locked_delete')}</span>}
            {rotationPanelOpen && !isWallItem(selected) && (isAdminViewer || !itemRotationLocked(selected)) && (
              <label className="toolbar-rotation-slider">
                <span>{selected.rotation || 0}°</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  value={selected.rotation || 0}
                  onInput={(event) => updateItem(selected.id, { rotation: Number(event.currentTarget.value) })}
                  onChange={(event) => updateItem(selected.id, { rotation: Number(event.target.value) })}
                />
              </label>
            )}
          </div>
        )}
      </section>

      {activeStep > 1 && (
      <aside className="config-panel">
        {activeStep === 3 ? (
          <FurnitureStepPanel
            items={sceneItems}
            catalog={placeableCatalog}
            pricing={scenePricing}
            salonLabel={salonLabel}
            selectedId={selectedId}
            readOnly={readOnly}
            onAdd={openAddItemConfigurator}
            onRemove={removeOptionalItem}
            onSelectItem={setSelectedId}
            onConfigureItem={(item) => setItemConfigModal({ mode: 'edit', item, entry: itemConfiguratorEntry(item) })}
            onNext={() => setActiveStep(4)}
          />
        ) : activeStep === 4 ? (
          <ValidationStepPanel
            area={area}
            layout={layout}
            standLabel={initialScene.project_name || 'Stand A-14'}
            carpetColor={selectedCarpetColor}
            carpetFootprintColor={selectedCarpetFootprintColor}
            carpetFootprintEnabled={effectiveCarpetFootprintEnabled}
            wallFabricColor={selectedWallFabricColor}
            technicalFloor={selectedTechnicalFloor}
            technicalFloorTrimType={technicalFloorTrimType}
            ledRailsEnabled={ledRailsEnabled}
            ledSpotCount={ledSpotCount}
            reserveRule={activeReserveRuleConfig}
            reserveOptionType={effectiveReserveOptionType}
            partitionHeadRule={activePartitionHeadRuleConfig}
            partitionHeadSides={effectivePartitionHeadSides}
            pricing={scenePricing}
            items={cartItems}
            catalog={availableCatalog}
            saveState={saveState}
            confirmState={confirmState}
            readOnly={readOnly}
            isAdminViewer={isAdminViewer}
            onConfirm={validateConfiguration}
          />
        ) : (
          <OptionsStepPanel
            activeStep={activeStep}
            area={area}
            layout={layout}
            standLabel={initialScene.project_name || 'Stand A-14'}
            openOptions={openOptions}
            toggleOption={toggleOption}
            selectedCarpetColor={selectedCarpetColor}
            selectedCarpetFootprintColor={selectedCarpetFootprintColor}
            carpetColors={carpetPalette}
            footprintColors={footprintPalette}
            carpetFootprintEnabled={effectiveCarpetFootprintEnabled}
            selectedWallFabricColor={selectedWallFabricColor}
            wallFabricColors={wallFabricPalette}
            wallCovers={wallCovers}
            wallCoverSurfaces={wallCoverSurfaces}
            wallCoverState={wallCoverState}
            defaultColorOptions={effectiveDefaultColorOptions}
            technicalFloorType={technicalFloorType}
            technicalFloorTrimType={technicalFloorTrimType}
            ledRailsEnabled={ledRailsEnabled}
            ledSpotCount={ledSpotCount}
            reserveRule={activeReserveRuleConfig}
            reserveOptionType={effectiveReserveOptionType}
            partitionHeadRule={activePartitionHeadRuleConfig}
            partitionHeadSides={effectivePartitionHeadSides}
            partitionHeadVisuals={partitionHeadVisuals}
            partitionHeadUploadState={itemOptionState}
            counterItems={includedCounterItems}
            counterColors={counterPalette}
            counterUploadState={itemOptionState}
            salonLabel={salonLabel}
            catalog={availableCatalog}
            readOnly={readOnly}
            carpetGroupConfigOptions={carpetGroupConfigOptionsList}
            carpetConfigOptions={carpetConfigOptions}
            carpetThick={carpetThick}
            footprintThick={footprintThick}
            onCarpetColor={(colorId) => !readOnly && setSelectedCarpetId(colorId)}
            onCarpetConfigOption={(optionId, checked) => !readOnly && setCarpetConfigOptions((current) => ({ ...current, [optionId]: checked }))}
            onCarpetThick={(v) => !readOnly && setCarpetThick(v)}
            onFootprintThick={(v) => !readOnly && setFootprintThick(v)}
            onCarpetFootprintColor={(colorId) => !readOnly && setSelectedCarpetFootprintId(colorId)}
            onCarpetFootprintEnabled={(enabled) => !readOnly && !selectedTechnicalFloor && setCarpetFootprintEnabled(enabled)}
            onWallColor={(colorId) => !readOnly && setSelectedWallFabricId(colorId)}
            onWallCoverToggle={toggleWallCover}
            onWallCoverImage={uploadWallCoverImage}
            onTechnicalFloorType={(type) => !readOnly && handleTechnicalFloorType(type)}
            onTechnicalFloorTrimType={(type) => !readOnly && setTechnicalFloorTrimType(type)}
            onLedRailsEnabled={(enabled) => !readOnly && setLedRailsEnabled(enabled)}
            onReserveOption={(type) => { if (!readOnly) { if (type === '__none__') { removeReserve(); } else { setReserveOptionType(type); } } }}
            onPartitionHeadSide={(side, enabled) => !readOnly && setPartitionHeadChoice((current) => ({ ...current, [side]: enabled }))}
            onPartitionHeadImage={uploadPartitionHeadVisual}
            onPartitionHeadResetImage={resetPartitionHeadVisual}
            onCounterImage={(item, file, optionKeys) => uploadItemImage(item, file, optionKeys)}
            onCounterOptions={updateItemOptions}
            onCounterVariant={updateIncludedCounterVariant}
            onSelectCounter={setSelectedId}
            isAdminViewer={isAdminViewer}
          />
        )}
      </aside>
      )}

      {itemConfigModal && (() => {
        const modalItem = itemConfigModal.item
          ? sceneItems.find((item) => item.id === itemConfigModal.item.id) || itemConfigModal.item
          : undefined;
        return (
          <ItemConfiguratorModal
            mode={itemConfigModal.mode}
            entry={itemConfigModal.entry}
            item={modalItem}
            salonLabel={salonLabel}
            visualContext={sceneVisualContext}
            items={sceneItems}
            width={width}
            depth={depth}
            uploadState={itemOptionState}
            onImageChange={uploadItemImage}
            onUpdateItemOptions={updateItemOptions}
            counterColors={counterPalette}
            onClose={closeItemConfigurator}
            onConfirm={confirmItemConfigurator}
          />
        );
      })()}

      {showCartBar && (
        <FurnitureCartBar
          items={cartItems}
          catalog={availableCatalog}
          selectedId={selectedId}
          total={scenePricing.total || 0}
          salonLabel={salonLabel}
          readOnly={readOnly}
          nextLabel={tRaw(language, 'cart_next')}
          nextDetail={activeStep === 2 ? tRaw(language, 'cart_next_furniture') : tRaw(language, 'cart_next_detail')}
          onAdd={() => setActiveStep(3)}
          onSelectItem={setSelectedId}
          onConfigureItem={(item) => setItemConfigModal({ mode: 'edit', item, entry: itemConfiguratorEntry(item) })}
          onRemove={removeOptionalItem}
          onNext={() => setActiveStep(activeStep === 2 ? 3 : 4)}
        />
      )}

      {activeStep > 1 && !showCartBar && !readOnly && (
      <footer className="configurator-footer">
        <div>
          <span>{tRaw(language, 'total_ht_estimated')}</span>
          <strong>{estimatedTotal.toLocaleString('fr-FR')} €</strong>
        </div>
        <nav>
          <button type="button" onClick={() => setActiveStep((step) => Math.max(1, step - 1))}>{tRaw(language, 'back')}</button>
          {activeStep < 4 && <button type="button" onClick={() => setActiveStep((step) => Math.min(4, step + 1))}>{tRaw(language, 'next_step')}</button>}
        </nav>
      </footer>
      )}
    </main>
    </LanguageContext.Provider>
  );
}

function ModalHead({ icon, title, salonLabel, onClose }) {
  const t = useT();
  return (
    <header className="modal-head">
      <div className="modal-title-group">
        {icon && <span className="modal-title-icon">{icon}</span>}
        <h2>{title}</h2>
      </div>
      <div className="modal-head-actions">
        <span>{salonLabel}</span>
        <button type="button" onClick={onClose} aria-label={t('modal_close')}>
          <X size={18} />
        </button>
      </div>
    </header>
  );
}

function ClientInfoModal({ salonLabel, contactDetails, onChange, onClose, onValidate }) {
  const t = useT();
  return (
    <section className="client-info-modal">
      <ModalHead title={t('client_title')} salonLabel={salonLabel} onClose={onClose} />
      <div className="client-info-content">
        <p>{t('client_intro')}</p>
        <div className="form-grid two">
          <label>{t('client_firstname')}<input value={contactDetails.firstName} onChange={(event) => onChange('firstName', event.target.value)} /></label>
          <label>{t('client_lastname')}<input value={contactDetails.lastName} onChange={(event) => onChange('lastName', event.target.value)} /></label>
        </div>
        <label className="form-row">{t('client_company')}<input value={contactDetails.company} onChange={(event) => onChange('company', event.target.value)} /></label>
        <div className="form-grid two">
          <label>{t('client_role')}<input value={contactDetails.role} onChange={(event) => onChange('role', event.target.value)} /></label>
          <label>{t('client_email')}<input type="email" value={contactDetails.email} onChange={(event) => onChange('email', event.target.value)} /></label>
        </div>
        <label className="form-row">{t('client_phone')}<input value={contactDetails.phone} onChange={(event) => onChange('phone', event.target.value)} /></label>

        <span className="form-section-label">{t('client_location')}</span>
        <label className="form-row">{t('client_address')}<input value={contactDetails.address} onChange={(event) => onChange('address', event.target.value)} /></label>
        <div className="form-grid two">
          <label>{t('client_zip')}<input value={contactDetails.zip} onChange={(event) => onChange('zip', event.target.value)} /></label>
          <label>{t('client_city')}<input value={contactDetails.city} onChange={(event) => onChange('city', event.target.value)} /></label>
        </div>
        <label className="form-row">{t('client_country')}
          <select value={contactDetails.country} onChange={(event) => onChange('country', event.target.value)}>
            <option>{t('country_france')}</option>
            <option>{t('country_belgium')}</option>
            <option>{t('country_switzerland')}</option>
            <option>{t('country_luxembourg')}</option>
          </select>
        </label>

        <span className="form-section-label">{t('client_placement')}</span>
        <label className="form-row locked-field">{t('client_salon')}<input value={contactDetails.salon} readOnly /><span>🔒</span></label>
        <div className="form-grid two locked">
          <label>{t('client_hall')}<input value={contactDetails.hall} readOnly /></label>
          <label>{t('client_placement_field')}<input value={contactDetails.emplacement} readOnly /></label>
        </div>
        <small>{t('client_note')}</small>
        <button className="modal-primary-button" type="button" onClick={onValidate}>{t('client_validate')}</button>
      </div>
    </section>
  );
}

function QuestionFaq() {
  const t = useT();
  const [openIndex, setOpenIndex] = React.useState(null);
  const faq = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3') },
    { q: t('faq_q4'), a: t('faq_a4') },
  ];
  return (
    <div className="question-faq">
      <span className="form-section-label">{t('question_faq_title')}</span>
      {faq.map((entry, index) => (
        <div key={index} className={openIndex === index ? 'faq-item open' : 'faq-item'}>
          <button type="button" onClick={() => setOpenIndex(openIndex === index ? null : index)}>
            <span>{entry.q}</span>
            {openIndex === index ? <Minus size={14} /> : <Plus size={14} />}
          </button>
          {openIndex === index && <p>{entry.a}</p>}
        </div>
      ))}
    </div>
  );
}

function QuestionModal({ salonLabel, form, onFormChange, onClose, onSubmit }) {
  const t = useT();
  return (
    <form className="question-modal" onSubmit={onSubmit}>
      <ModalHead icon={<HelpCircle size={19} />} title={t('question_title')} salonLabel={salonLabel} onClose={onClose} />
      <div className="question-content">
        <p>{t('question_intro')}</p>

        <QuestionFaq />

        <label className="form-row">{t('question_subject')}
          <input value={form.subject} onChange={(event) => onFormChange('subject', event.target.value)} placeholder={t('question_subject_placeholder')} />
        </label>

        <label className="form-row">{t('question_message')}
          <textarea
            value={form.message}
            onChange={(event) => onFormChange('message', event.target.value)}
            maxLength={500}
          />
          <em>{form.message.length} / 500</em>
        </label>

        <span className="form-section-label">{t('question_attachments')}</span>
        <label className="file-drop">
          <Paperclip size={18} />
          <span>{t('question_drag')}</span>
          <strong>{t('question_browse')}</strong>
          <small>{t('question_file_types')}</small>
          <input type="file" />
        </label>

        <div className="question-note">{t('question_note')}</div>
        <button className="modal-primary-button centered" type="submit"><Mail size={15} /> {t('question_send')}</button>
        <button className="modal-cancel-button" type="button" onClick={onClose}>{t('question_cancel')}</button>
      </div>
    </form>
  );
}

function LanguageMenu({ language, onSelect }) {
  const t = useT();
  return (
    <section className="language-menu" onMouseDown={(event) => event.stopPropagation()}>
      <h3>{t('lang_title')}</h3>
      {languages.map((entry) => (
        <button key={entry.id} className={language === entry.id ? 'active' : ''} type="button" onClick={() => onSelect(entry.id)}>
          <span className="language-flag">{entry.flag}</span>
          <span>
            <strong>{entry.label}</strong>
            <small>{entry.sublabel}</small>
          </span>
          <em>{entry.short}</em>
          {language === entry.id && <Check size={14} />}
        </button>
      ))}
      <p>{t('lang_note')}</p>
    </section>
  );
}

function PartitionHeadOptionsPanel({ item, visualContext, uploadState, onImageChange, onResetImage, embedded = false }) {
  const t = useT();
  const imageName = item.options?.headMainImageName || `Texture originale ${partitionHeadMainImageMaterial(item)}.jpg`;
  return (
    <aside className={embedded ? 'item-visual-config' : 'item-options-panel'}>
      <div className="item-options-heading">
        <FileImage size={17} />
        <div>
          <strong>{t('partition_head_title')}</strong>
          <span>{t('partition_head_subtitle')}</span>
        </div>
      </div>

      <div className="item-dynamic-preview">
        <span className="preview-flag">{languageFlag(visualContext?.language)}</span>
        <strong>{visualContext?.company || t('partition_head_company')}</strong>
        <span>{isSmclPartitionHeadItem(item) ? `Allée ${visualContext?.aisleNumber || '—'} · ${visualContext?.standNumber || '—'}` : (visualContext?.standNumber || 'A-14')}</span>
      </div>

      <label className="item-image-upload">
        <span>{t('partition_head_image')}</span>
        <small>{imageName}</small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploadState?.uploading}
          onChange={(event) => {
            onImageChange(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>

      {item.options?.headMainImageUrl && (
        <button className="item-image-reset" type="button" onClick={onResetImage}>{t('img_upload_reset')}</button>
      )}
      {uploadState?.uploading && <p className="item-options-status">{t('img_uploading')}</p>}
      {uploadState?.error && <p className="item-options-error">{uploadState.error}</p>}
    </aside>
  );
}

function PosterOptionsPanel({ item, items, width, depth, uploadState, onImageChange, onResetImage, embedded = false }) {
  const t = useT();
  const imageName = item.options?.posterImageName || t('poster_no_image');
  const printSize = posterSurfaceRegion(item, items, width, depth);
  const recommendedSpec = recommendedSimulatorImageSpec(printSize.width, printSize.height);
  const imageQuality = useSimulatorImageQualityCheck(item.options?.posterImageUrl, recommendedSpec);
  return (
    <aside className={embedded ? 'item-visual-config' : 'item-options-panel'}>
      <div className="item-options-heading">
        <FileImage size={17} />
        <div>
          <strong>{t('poster_title')}</strong>
          <span>{t('poster_subtitle')}</span>
        </div>
      </div>

      <div className="poster-format-spec">
        <strong>{t('poster_format_title')}</strong>
        <span>{t('poster_format_zone', { size: recommendedSpec.sizeText })}</span>
        <span>{t('poster_format_image', { pixels: recommendedSpec.pixelText })}</span>
        <small>{t('poster_format_ratio', { ratio: recommendedSpec.ratioText })}</small>
      </div>

      {item.options?.posterImageUrl && (
        <div className="poster-image-preview">
          <img src={item.options.posterImageUrl} alt="" />
        </div>
      )}

      {item.options?.posterImageUrl && imageQuality && (
        <div className={`poster-print-quality ${imageQuality.level}`}>
          <strong>{imageQuality.level === 'good' ? t('img_quality_ok') : imageQuality.level === 'warning' ? t('img_quality_warning') : t('img_quality_danger')}</strong>
          <span>{imageQuality.pixelText} importés · conseillé {recommendedSpec.pixelText}</span>
          <small>{imageQuality.level === 'good' ? t('img_quality_ok_detail') : t('img_quality_low_detail')}</small>
        </div>
      )}

      <label className="item-image-upload">
        <span>{t('poster_image_label')}</span>
        <small>{imageName}</small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploadState?.uploading}
          onChange={(event) => {
            onImageChange(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>

      {item.options?.posterImageUrl && (
        <button className="item-image-reset" type="button" onClick={onResetImage}>{t('poster_reset')}</button>
      )}
      {uploadState?.uploading && <p className="item-options-status">{t('img_uploading')}</p>}
      {uploadState?.error && <p className="item-options-error">{uploadState.error}</p>}
    </aside>
  );
}

function WoodReceptionDeskOptionsPanel({ item, colors = [], uploadState, onImageChange, onResetImage, onColorChange, onResetColor, embedded = false, optionsFree = false }) {
  const t = useT();
  const imageName = item.options?.binary3ImageName || 'Texture originale Binary_3.jpeg';
  const selectedColor = item.options?.binary2Color || '#ffffff';
  const selectedColorId = item.options?.binary2ColorId || '';
  return (
    <aside className={embedded ? 'item-visual-config' : 'item-options-panel'}>
      <div className="item-options-heading">
        <FileImage size={17} />
        <div>
          <strong>{t('wood_desk_title')}</strong>
          <span>{t('wood_desk_subtitle')}</span>
        </div>
      </div>

      {item.options?.binary3ImageUrl && (
        <div className="poster-image-preview">
          <img src={item.options.binary3ImageUrl} alt="" />
        </div>
      )}

      <label className="item-image-upload">
        <span>{t('wood_desk_image_label')}</span>
        <small>{imageName}</small>
        <small>
          {(() => { const [w, h] = woodReceptionDeskImageCoverSize(item); return t('img_format_spec', { w: w.toLocaleString('fr-FR'), h: h.toLocaleString('fr-FR') }); })()}
        </small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploadState?.uploading}
          onChange={(event) => {
            onImageChange(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>

      {colors.length ? (
        <div className="item-counter-color-palette">
          <span>Couleur du matériau Laminate_D02_120cm_6</span>
          <div>
            {colors.map((color) => (
              <button
                key={color.id}
                type="button"
                className={selectedColorId === color.id || (!selectedColorId && selectedColor === color.hex) ? 'active' : ''}
                style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                title={`${color.name} (${color.code})`}
                onClick={() => onColorChange?.(color)}
              >
                <i />
                <strong>{color.name}</strong>
                <small>{color.reference || color.code}{!optionsFree && Number(color.price || 0) > 0 ? ` · +${Number(color.price).toLocaleString('fr-FR')} € HT/m²` : ` ${t('wood_desk_color_included')}`}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="item-color-upload unavailable">
          <span>Couleur du matériau Laminate_D02_120cm_6</span>
          <strong>{t('wood_desk_no_color')}</strong>
        </div>
      )}

      <div className="item-option-actions">
        {item.options?.binary3ImageUrl && <button className="item-image-reset" type="button" onClick={onResetImage}>{t('wood_desk_reset_image')}</button>}
        {item.options?.binary2Color && <button className="item-image-reset" type="button" onClick={onResetColor}>{t('wood_desk_reset_color')}</button>}
      </div>
      {uploadState?.uploading && <p className="item-options-status">{t('img_uploading')}</p>}
      {uploadState?.error && <p className="item-options-error">{uploadState.error}</p>}
    </aside>
  );
}

function CounterOptionCard({ items = [], colors = [], catalog = [], salonLabel = '', uploadState = {}, disabled = false, onImage, onOptions, onVariant, onSelect }) {
  const t = useT();
  const [selectedCounterId, setSelectedCounterId] = useState(items[0]?.id || '');

  useEffect(() => {
    if (!items.length) {
      setSelectedCounterId('');
      return;
    }
    if (!items.some((item) => item.id === selectedCounterId)) {
      setSelectedCounterId(items[0].id);
    }
  }, [items, selectedCounterId]);

  const selectedItem = items.find((item) => item.id === selectedCounterId) || items[0] || null;
  const counterVariants = counterVariantOptions(catalog, salonLabel);
  const baseVariant = counterVariants[0] || null;
  const selectedVariant = counterVariants.find((variant) => variant.assetType === selectedItem?.type || variant.id === selectedItem?.options?.variantId) || baseVariant;
  const baseVariantPrice = Number(baseVariant?.price || 0);
  const selectedColorId = selectedItem?.options?.binary2ColorId || counterWoodFinish(colors).id;
  const selectedFinish = counterFinishOptions(colors).find((finish) => finish.id === selectedColorId) || counterWoodFinish(colors);
  const imageName = selectedItem?.options?.binary3ImageName || t('counter_no_logo');
  const logoInputRef = useRef(null);

  const selectCounter = (id) => {
    setSelectedCounterId(id);
    onSelect?.(id);
  };
  const updateSelected = (patch) => {
    if (!selectedItem) return;
    onOptions?.(selectedItem, patch);
  };
  const uploadSelectedImage = (file) => {
    if (!selectedItem || !file) return;
    onImage?.(selectedItem, file, { urlKey: 'binary3ImageUrl', nameKey: 'binary3ImageName' });
  };
  const selectVariant = (variant) => {
    if (!selectedItem || !variant?.entry) return;
    const upgradePrice = Math.max(0, Number(variant.price || 0) - baseVariantPrice);
    onVariant?.(selectedItem, variant.entry, {
      ...(selectedItem.options || {}),
      variantId: variant.id,
      variantLabel: variant.label,
      variantReference: variant.reference,
      variantAssetType: variant.assetType,
      variantUpgradePrice: upgradePrice,
      variantBasePrice: baseVariantPrice,
      includedBaseType: baseVariant?.assetType || '',
      unitPrice: 0,
    });
  };
  const selectFinish = (finish) => {
    if (!selectedItem) return;
    updateSelected(counterFinishPatch(finish));
  };

  if (!items.length) {
    return (
      <div className="counter-option-panel">
        <div className="counter-empty-card">
          <strong>{t('counter_empty_title')}</strong>
          <span>{t('counter_empty_detail')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="counter-option-panel">
      <div className="counter-formula-box">
        <span><b>!</b> {t('counter_formula_title')}</span>
        <p>{t('counter_formula_detail')}</p>
      </div>

      {items.length > 1 && (
        <div className="counter-selector">
          <span>{t('counter_selector_label')}</span>
          <div>
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedItem?.id ? 'active' : ''}
                onClick={() => selectCounter(item.id)}
              >
                {item.label || `Banque ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {counterVariants.length > 1 && (
        <section className="counter-size-card">
          <header>
            <div>
              <strong>{t('counter_size_title')}</strong>
              <span>{selectedVariant?.label || selectedItem?.label || t('option_counter')}</span>
            </div>
          </header>
          <div className="counter-size-grid">
            {counterVariants.map((variant) => {
              const active = selectedVariant?.assetType === variant.assetType;
              const supplement = Math.max(0, Number(variant.price || 0) - baseVariantPrice);
              return (
                <button key={variant.id} type="button" className={active ? 'active' : ''} disabled={disabled} onClick={() => selectVariant(variant)}>
                  <span><strong>{counterSizeLabel(variant)}</strong></span>
                  <em>{supplement > 0 ? `+ ${supplement.toLocaleString('fr-FR')} € HT` : t('color_included')}</em>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <CounterFinishCard
        finishes={counterFinishOptions(colors)}
        selectedFinish={selectedFinish}
        disabled={disabled}
        onSelect={selectFinish}
      />

      <section className="counter-logo-card">
        <header>
          <div>
            <strong>{t('counter_logo_title')}</strong>
            <span>{selectedItem?.options?.binary3ImageUrl ? t('counter_logo_custom') : t('counter_logo_default')}</span>
          </div>
          {selectedItem?.options?.binary3ImageUrl && <em>{t('counter_logo_ok')}</em>}
        </header>
        <small className="counter-logo-spec">
          {(() => { const [w, h] = woodReceptionDeskImageCoverSize(selectedItem); return t('img_format_spec', { w: w.toLocaleString('fr-FR'), h: h.toLocaleString('fr-FR') }); })()}
        </small>

        <label className={selectedItem?.options?.binary3ImageUrl ? 'counter-image-dropzone has-image' : 'counter-image-dropzone'}>
          {selectedItem?.options?.binary3ImageUrl ? <img src={selectedItem.options.binary3ImageUrl} alt="" /> : <FileImage size={22} />}
          <span>
            <strong>{imageName}</strong>
            <small>{selectedItem?.options?.binary3ImageUrl ? t('counter_logo_replace_hint') : t('counter_logo_add')}</small>
          </span>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || uploadState?.uploading}
            onChange={(event) => {
              uploadSelectedImage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>

        <div className="counter-logo-actions">
          <button type="button" className="counter-secondary-button" disabled={disabled || uploadState?.uploading} onClick={() => logoInputRef.current?.click()}>
            {t('counter_replace')}
          </button>
          {selectedItem?.options?.binary3ImageUrl && (
            <button
              type="button"
              className="counter-secondary-button danger"
              disabled={disabled}
              onClick={() => updateSelected({ binary3ImageUrl: '', binary3ImageName: '' })}
            >
              <X size={15} /> {t('counter_remove')}
            </button>
          )}
        </div>
      </section>

      <section className="counter-info-card">
        <strong>{t('counter_why_title')}</strong>
        <ul>
          <li>{t('counter_why_1')}</li>
          <li>{t('counter_why_2')}</li>
          <li>{t('counter_why_3')}</li>
          <li>{t('counter_why_4')}</li>
        </ul>
      </section>

      {uploadState?.uploading && <p className="counter-status">{t('counter_uploading')}</p>}
      {uploadState?.error && <p className="counter-error">{uploadState.error}</p>}
    </div>
  );
}




function CounterFinishCard({ finishes = [], selectedFinish = {}, disabled = false, onSelect }) {
  const t = useT();
  const includedFinishes = finishes.filter((finish) => finish.included || finish.mode === 'wood');
  const optionalFinishes = finishes.filter((finish) => !includedFinishes.some((included) => included.id === finish.id));
  const optionPrice = optionalFinishes.find((finish) => Number(finish.price || 0) > 0)?.price || 0;
  const selectedCode = selectedFinish.code || selectedFinish.reference || '';
  return (
    <section className="counter-color-card counter-finish-card">
      <div className="counter-finish-head">
        <strong>{t('counter_finish_title')}</strong>
        <span>{shortFinishName(selectedFinish.name)}{shortFinishCode(selectedCode) ? ` (${shortFinishCode(selectedCode)})` : ''}</span>
      </div>
      <small>{t('carpet_included_count', { count: includedFinishes.length || 1, s: (includedFinishes.length || 1) > 1 ? 's' : '' })}</small>
      <div className="counter-finish-swatches included">
        {(includedFinishes.length ? includedFinishes : [counterWoodFinish()]).map((finish) => (
          <CounterFinishSwatch key={finish.id} finish={finish} active={selectedFinish.id === finish.id} disabled={disabled} onClick={() => onSelect?.(finish)} />
        ))}
      </div>
      {optionalFinishes.length > 0 && (
        <>
          <small>{t('carpet_option_from', { price: Number(optionPrice || 0) > 0 ? Number(optionPrice).toLocaleString('fr-FR') : '' })}</small>
          <div className="counter-finish-swatches optional">
            {optionalFinishes.map((finish) => (
              <CounterFinishSwatch key={finish.id} finish={finish} active={selectedFinish.id === finish.id} disabled={disabled} onClick={() => onSelect?.(finish)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CounterFinishSwatch({ finish = {}, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      style={{ '--swatch-color': finish.hex, '--swatch-image': finish.image ? `url("${finish.image}")` : 'none' }}
      title={`${shortFinishName(finish.name)}${finish.code ? ` (${shortFinishCode(finish.code)})` : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <i className={finish.mode === 'wood' ? 'wood' : ''} />
      <span>{shortFinishName(finish.name)}</span>
    </button>
  );
}

function counterVariantOptions(catalog = [], salonLabel = '') {
  const group = catalog.find((entry) => isVariantGroupEntry(entry) && isCounterVariantGroup(entry));
  if (group) return normalizeVariantGroupOptions(group.dimensions?.variantAssets, salonLabel).filter((variant) => isWoodReceptionDeskItem(variant.entry));
  return catalog
    .filter(isWoodReceptionDeskItem)
    .map((entry, index) => ({
      id: entry.type,
      assetType: entry.type,
      label: entry.label || `Banque ${index + 1}`,
      detail: assetDimensionsLabel({ dimensions: entry.dimensions }) || '',
      price: assetUnitPrice(entry, salonLabel),
      reference: assetReference(entry, salonLabel),
      imageUrl: entry.thumbnailUrl || '',
      isDefault: index === 0,
      entry,
    }));
}

function isCounterVariantGroup(entry = {}) {
  const text = normalizeTextValue(`${entry.label || ''} ${entry.type || ''}`);
  if (text.includes('banque') && text.includes('accueil')) return true;
  if (text.includes('comptoir')) return true;
  return (entry.dimensions?.variantAssets || []).some(isWoodReceptionDeskItem);
}

function counterSizeLabel(variant = {}) {
  const text = normalizeTextValue(`${variant.label || ''} ${variant.assetType || ''} ${variant.detail || ''}`);
  const size = itemDefaultSize(variant.entry || {});
  const width = Number(size?.[0] || 0);
  const raw = width || Number((text.match(/(\d+(?:[,.]\d+)?)\s*m/) || [])[1]?.replace(',', '.') || 0);
  if (raw >= 1.85) return '2 mètres';
  if (raw >= 1.25) return '1 mètre 50';
  return '1 mètre';
}

function counterWhiteFinish() {
  return { id: '__counter-white__', name: 'Blanc', code: '', hex: '#ffffff', image: '', price: 98, mode: 'white' };
}

function shortFinishName(name = '') {
  const stripped = String(name)
    .replace(/^\s*[A-Z]\d+\s+/, '')
    .replace(/\s+[A-Z]{2,3}\d+.*$/, '')
    .trim();
  return stripped || name;
}

function shortFinishCode(code = '') {
  const match = String(code).match(/^([A-Z]\d+)\b/);
  return match ? match[1] : code;
}

function counterWoodFinish(colors = []) {
  const configured = colors.find((color) => /bois|wood/i.test(`${color.name || ''} ${color.code || ''} ${color.reference || ''}`));
  return {
    id: configured?.id || '__counter-wood__',
    name: configured?.name || 'Bois',
    code: configured?.code || configured?.reference || 'H3303',
    hex: configured?.hex || '#c49b63',
    image: configured?.image || '',
    price: 0,
    reference: configured?.reference || 'H3303',
    mode: 'wood',
    included: true,
  };
}

function counterFinishOptions(colors = []) {
  const white = counterWhiteFinish();
  const wood = counterWoodFinish(colors);
  const paidColors = colors
    .filter((color) => normalizeColorId(color.id) !== normalizeColorId(wood.id))
    .filter((color) => !/bois|wood/i.test(`${color.name || ''} ${color.code || ''} ${color.reference || ''}`))
    .map((color) => ({ ...color, mode: 'color', price: (color.isFree || color.included) ? 0 : Number(color.price || white.price) }));
  return [wood, white, ...paidColors];
}

function counterFinishPatch(finish = {}) {
  const isWhite = finish.mode === 'white' || finish.id === counterWhiteFinish().id;
  const isWood = finish.mode === 'wood';
  return {
    binary2Color: isWood ? '' : (finish.hex || '#ffffff'),
    binary2ColorImage: isWood ? '' : (finish.image || ''),
    binary2ColorId: finish.id || '',
    binary2ColorName: finish.name || '',
    binary2ColorReference: finish.reference || finish.code || '',
    binary2ColorPrice: isWood ? 0 : Number(finish.price || 0),
    binary2ColorMode: finish.mode || 'color',
  };
}

function counterVariantUpgradeOptionLine(item = {}, entry = {}, salonLabel = '', index = 0) {
  const upgradePrice = Number(item.options?.variantUpgradePrice || 0);
  if (!isIncludedSceneItem(item) || !isWoodReceptionDeskItem({ ...entry, ...item }) || upgradePrice <= 0) return null;
  return {
    type: `counter-size-${item.id || entry?.type || index}`,
    label: `Option taille banque d'accueil — ${item.options?.variantLabel || entry?.label || item.label || item.type}`,
    quantity: 1,
    unitPrice: upgradePrice,
    total: upgradePrice,
    reference: item.options?.variantReference || assetReference(entry, salonLabel),
    optionForItemId: item.id || '',
  };
}

function recommendedSimulatorImageSpec(printWidthMeters = 0, printHeightMeters = 0, maxLongEdge = 2048) {
  const safeWidth = Math.max(0.001, Number(printWidthMeters || 0));
  const safeHeight = Math.max(0.001, Number(printHeightMeters || 0));
  const ratio = safeWidth / safeHeight;
  const pixelsWidth = ratio >= 1 ? maxLongEdge : Math.round(maxLongEdge * ratio);
  const pixelsHeight = ratio >= 1 ? Math.round(maxLongEdge / ratio) : maxLongEdge;
  return {
    pixelsWidth,
    pixelsHeight,
    pixelText: `${pixelsWidth.toLocaleString('fr-FR')} × ${pixelsHeight.toLocaleString('fr-FR')} px`,
    sizeText: `${safeWidth.toFixed(2)} × ${safeHeight.toFixed(2)} m`,
    ratioText: `${safeWidth.toFixed(2)}:${safeHeight.toFixed(2)}`,
  };
}

function useSimulatorImageQualityCheck(imageUrl, recommendedSpec = null) {
  const [quality, setQuality] = useState(null);

  useEffect(() => {
    if (!imageUrl || !recommendedSpec?.pixelsWidth || !recommendedSpec?.pixelsHeight) {
      setQuality(null);
      return undefined;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      const pixelsWidth = image.naturalWidth || image.width || 0;
      const pixelsHeight = image.naturalHeight || image.height || 0;
      const widthRatio = pixelsWidth / recommendedSpec.pixelsWidth;
      const heightRatio = pixelsHeight / recommendedSpec.pixelsHeight;
      const ratioScore = Math.min(widthRatio, heightRatio);
      const level = ratioScore >= 1 ? 'good' : ratioScore >= 0.7 ? 'warning' : 'danger';
      setQuality({
        level,
        pixelText: `${pixelsWidth.toLocaleString('fr-FR')} × ${pixelsHeight.toLocaleString('fr-FR')} px`,
      });
    };
    image.onerror = () => {
      if (!cancelled) setQuality(null);
    };
    image.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, recommendedSpec?.pixelsWidth, recommendedSpec?.pixelsHeight]);

  return quality;
}

function OptionsStepPanel({
  activeStep,
  area,
  layout,
  standLabel,
  openOptions,
  toggleOption,
  selectedCarpetColor,
  selectedCarpetFootprintColor,
  carpetColors = [],
  footprintColors = [],
  carpetFootprintEnabled,
  selectedWallFabricColor,
  wallFabricColors = [],
  wallCovers = {},
  wallCoverSurfaces = [],
  wallCoverState = {},
  defaultColorOptions = {},
  technicalFloorType,
  technicalFloorTrimType,
  ledRailsEnabled,
  ledSpotCount,
  reserveRule,
  reserveOptionType,
  partitionHeadRule,
  partitionHeadSides,
  partitionHeadVisuals = {},
  partitionHeadUploadState = {},
  counterItems = [],
  counterColors = [],
  counterUploadState = {},
  salonLabel,
  catalog,
  readOnly = false,
  carpetGroupConfigOptions = [],
  carpetConfigOptions = {},
  carpetThick = false,
  footprintThick = false,
  onCarpetColor,
  onCarpetConfigOption,
  onCarpetThick,
  onFootprintThick,
  onCarpetFootprintColor,
  onCarpetFootprintEnabled,
  onWallColor,
  onWallCoverToggle,
  onWallCoverImage,
  onTechnicalFloorType,
  onTechnicalFloorTrimType,
  onLedRailsEnabled,
  onReserveOption,
  onPartitionHeadSide,
  onPartitionHeadImage,
  onPartitionHeadResetImage,
  onCounterImage,
  onCounterOptions,
  onCounterVariant,
  onSelectCounter,
  isAdminViewer = false,
}) {
  const t = useT();
  return (
    <>
      <PanelHead title={t('panel_options_title')} step={activeStep} />
      <RulesSummary ledSpotCount={ledSpotCount} ledRailsEnabled={ledRailsEnabled} reserveRule={reserveRule} partitionHeadRule={partitionHeadRule} />

      <section className="panel-section-title">{t('section_options')}</section>
      <OptionAccordion title={t('option_carpet')} icon={<Layers size={16} />} open={openOptions.moquette} onToggle={() => toggleOption('moquette')}>
        <CarpetColorOptionCard
          colors={carpetColors}
          selectedColor={selectedCarpetColor}
          defaultColorId={defaultColorOptions.carpetColorId}
          area={area}
          disabled={readOnly}
          configOptions={carpetGroupConfigOptions}
          selectedOptions={carpetConfigOptions}
          thick={carpetThick}
          onSelect={onCarpetColor}
          onOptionToggle={onCarpetConfigOption}
          onThickChange={onCarpetThick}
        />
      </OptionAccordion>
      <OptionAccordion title={t('option_footprint')} icon={<Layers size={16} />} open={openOptions.empreinte} onToggle={() => toggleOption('empreinte')}>
        <FootprintColorOptionCard
          enabled={carpetFootprintEnabled}
          colors={footprintColors}
          selectedColor={selectedCarpetFootprintColor}
          defaultColorId={defaultColorOptions.carpetFootprintColorId || defaultColorOptions.carpetColorId}
          area={carpetFootprintAreaM2()}
          disabled={readOnly || Boolean(technicalFloorType)}
          disabledReason={technicalFloorType ? t('floor_warning') : ''}
          thick={footprintThick}
          onEnabledChange={onCarpetFootprintEnabled}
          onSelect={onCarpetFootprintColor}
          onThickChange={onFootprintThick}
        />
      </OptionAccordion>
      <OptionAccordion title={t('option_wall')} icon={<Box size={16} />} open={openOptions.coton} onToggle={() => toggleOption('coton')}>
        <ColorOptionCard
          title={t('color_title')}
          colors={wallFabricColors}
          selectedColor={selectedWallFabricColor}
          defaultColorId={defaultColorOptions.wallFabricColorId}
          includedLabel={t('color_included')}
          optionLabel={t('color_options_paid')}
          disabled={readOnly}
          onSelect={onWallColor}
        />
        <WallCoverOptionCard
          surfaces={wallCoverSurfaces}
          covers={wallCovers}
          uploadState={wallCoverState}
          disabled={readOnly}
          onToggle={onWallCoverToggle}
          onImage={onWallCoverImage}
        />
      </OptionAccordion>
      {isAdminViewer && (
      <OptionAccordion title={t('option_floor')} icon={<Ruler size={16} />} open={openOptions.plancher} onToggle={() => toggleOption('plancher')}>
        <TechnicalFloorOptionCard
          floorType={technicalFloorType}
          trimType={technicalFloorTrimType}
          area={area}
          layout={layout}
          disabled={readOnly}
          onFloorType={onTechnicalFloorType}
          onTrimType={onTechnicalFloorTrimType}
        />
      </OptionAccordion>
      )}
      <OptionAccordion title={t('option_led')} icon={<Sparkles size={16} />} open={openOptions.led} onToggle={() => toggleOption('led')}>
        <LedRailOptionCard
          enabled={ledRailsEnabled}
          spotCount={ledSpotCount}
          disabled={readOnly}
          onChange={onLedRailsEnabled}
        />
      </OptionAccordion>
      <OptionAccordion title={t('option_reserve')} icon={<Layers size={16} />} open={openOptions.reserve} onToggle={() => toggleOption('reserve')}>
        <ReserveOptionCard
          rule={reserveRule}
          selectedOptionType={reserveOptionType}
          catalog={catalog}
          salonLabel={salonLabel}
          disabled={readOnly}
          onChange={onReserveOption}
        />
      </OptionAccordion>
      <OptionAccordion title={t('option_partition_head')} icon={<Ruler size={16} />} open={openOptions.tete} onToggle={() => toggleOption('tete')}>
        <PartitionHeadOptionCard
          rule={partitionHeadRule}
          sides={partitionHeadSides}
          catalog={catalog}
          salonLabel={salonLabel}
          disabled={readOnly}
          visualOptions={partitionHeadVisuals}
          uploadState={partitionHeadUploadState}
          onChange={onPartitionHeadSide}
          onImage={onPartitionHeadImage}
          onResetImage={onPartitionHeadResetImage}
        />
      </OptionAccordion>
      <OptionAccordion title={t('option_counter')} icon={<Box size={16} />} open={openOptions.comptoir} onToggle={() => toggleOption('comptoir')}>
        <CounterOptionCard
          items={counterItems}
          colors={counterColors}
          uploadState={counterUploadState}
          catalog={catalog}
          salonLabel={salonLabel}
          disabled={readOnly}
          onImage={onCounterImage}
          onOptions={onCounterOptions}
          onVariant={onCounterVariant}
          onSelect={onSelectCounter}
        />
      </OptionAccordion>

    </>
  );
}

function FurnitureStepPanel({ items, catalog, pricing, salonLabel, selectedId, readOnly = false, onAdd, onRemove, onSelectItem, onConfigureItem, onNext }) {
  const t = useT();
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const groupedVariantTypes = variantGroupMemberTypes(catalog);
  const entries = catalog.filter((entry) => (
    !['hidden'].includes(furniturePanelCategory(entry))
    && !groupedVariantTypes.has(entry.type)
    && (!isVariantGroupEntry(entry) || entry.dimensions?.variantAssets?.length)
  ));
  const categories = marketplaceCategories(entries);
  const selectedCategory = categories.find((category) => category.id === activeCategory) || categories[0];
  const filteredEntries = entries.filter((entry) => {
    const entryCategory = furniturePanelCategory(entry);
    const matchesCategory = activeCategory === 'all' || entryCategory === activeCategory || normalizeMarketCategory(entry) === activeCategory;
    const searchText = [entry.label, entry.type, entry.dimensions?.category, marketplaceItemSubtitle(entry, marketCategoryMeta(normalizeMarketCategory(entry)).label)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesSearch = !search || searchText.includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  return (
    <>
      <PanelHead title={t('panel_furniture_title')} step={3} />
      <p className="marketplace-subtitle">{t('furniture_subtitle')}</p>

      <label className="marketplace-search">
        <Search size={15} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('furniture_search')} />
      </label>

      <nav className="marketplace-tabs" aria-label={t('furniture_aria_filter')}>
        {categories.map((category) => (
          <button key={category.id} type="button" className={selectedCategory?.id === category.id ? 'active' : ''} onClick={() => setActiveCategory(category.id)}>
            <span>{category.icon}</span>{category.label}<em>{category.count}</em>
          </button>
        ))}
      </nav>


      <section className="marketplace-grid">
        {filteredEntries.map((entry, index) => (
          <MarketplaceCard
            key={entry.type}
            entry={entry}
            index={index}
            salonLabel={salonLabel}
            catalog={catalog}
            readOnly={readOnly}
            includedCount={pricing?.includedCounts?.get(entry.type) || 0}
            billableCount={pricing?.billableCounts?.get(entry.type) || 0}
            onAdd={() => onAdd(entry)}
            onRemoveOne={() => onRemove(entry.type)}
          />
        ))}
        {!filteredEntries.length && <div className="marketplace-empty">{t('furniture_empty')}</div>}
      </section>
    </>
  );
}

function MarketplaceCard({ entry, index, salonLabel, catalog, readOnly, includedCount = 0, billableCount = 0, onAdd, onRemoveOne }) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const Icon = entry.icon || Box;
  const price = marketplaceStartingPrice(entry, catalog, salonLabel);
  const category = marketCategoryMeta(normalizeMarketCategory(entry));
  const label = localizeItemLabel(entry, lang);
  return (
    <article className="marketplace-card">
      <div className="marketplace-card-preview">
        {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <Icon size={42} />}
      </div>
      <div className="marketplace-card-body">
        <strong>{label}</strong>
        {price ? <em>{t('market_from_price', { price: price.toLocaleString('fr-FR') })}</em> : null}
        <small>{marketplaceItemSubtitle(entry, category.label)}</small>
        {billableCount > 0 ? (
          <div className="marketplace-card-counter">
            <button type="button" disabled={readOnly} onClick={() => onRemoveOne?.()} aria-label={`- ${label}`}>
              <Minus size={14} />
            </button>
            <span>{billableCount}</span>
            <button type="button" disabled={readOnly} onClick={onAdd} aria-label={`+ ${label}`}>
              <Plus size={14} />
            </button>
          </div>
        ) : (
          <button type="button" disabled={readOnly} onClick={onAdd} aria-label={`+ ${label}`}>
            <Plus size={18} />
          </button>
        )}
      </div>
    </article>
  );
}

function FurnitureCartBar({ items, catalog, selectedId, total, salonLabel, readOnly, nextLabel, nextDetail, onAdd, onSelectItem, onConfigureItem, onRemove, onNext }) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const itemRefs = useRef(new Map());

  useEffect(() => {
    if (!selectedId) return;
    const selectedNode = itemRefs.current.get(selectedId);
    selectedNode?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedId, items.length]);

  return (
    <div className="furniture-cart-bar">
      <div className="cart-total-card">
        <ClockIcon />
        <span>{t('cart_my_stand')}</span>
        <small>{t('cart_articles', { count: items.length, s: items.length > 1 ? 's' : '' })}</small>
        <strong>{total.toLocaleString('fr-FR')} €</strong>
      </div>
      <button type="button" className="cart-add-card" onClick={onAdd} disabled={readOnly}>
        <span><Plus size={18} /></span>
        <strong>{t('cart_add')}</strong>
        <small>{t('cart_add_detail')}</small>
      </button>
      <div className="cart-item-strip">
        {items.map((item) => {
          const entry = findCatalogEntry(catalog, item.type) || item;
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) itemRefs.current.set(item.id, node);
                else itemRefs.current.delete(item.id);
              }}
              type="button"
              className={`cart-item-card ${selected ? 'active' : ''}`}
              onClick={() => onSelectItem(item.id)}
            >
              <span className="cart-item-thumb">{entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <Box size={22} />}</span>
              <span>
                <strong>{itemCartLabel(item)}</strong>
                <small>{item.options?.variantLabel || t('cart_quantity')}</small>
                <em>{cartItemPrice(item, entry, salonLabel).toLocaleString('fr-FR')} €</em>
              </span>
              <span className="cart-item-settings" onClick={(event) => { event.stopPropagation(); onConfigureItem(item); }}>•••</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="cart-next-button" onClick={onNext}>{nextLabel}<br /><span>{nextDetail}</span></button>
    </div>
  );
}

function ClockIcon() {
  return <span className="cart-clock">◷</span>;
}

function ItemConfiguratorModal({ mode, entry, item, salonLabel, visualContext, items, width, depth, uploadState, onImageChange, onUpdateItemOptions, counterColors = [], onClose, onConfirm }) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const catalogEntry = entry || item || {};
  const isVariantGroup = isVariantGroupEntry(catalogEntry);
  const initialOptions = item?.options || {};
  const variants = itemConfigVariants(catalogEntry, salonLabel);
  const extraOptions = itemConfigExtraOptions(catalogEntry);
  const defaultVariant = variants.find((variant) => variant.isDefault) || variants[0];
  const [format, setFormat] = useState(initialOptions.variantId || initialOptions.format || defaultVariant?.id || 'standard');
  const [selectedExtras, setSelectedExtras] = useState(() => {
    const previous = initialOptions.extraOptions || {};
    return extraOptions.reduce((acc, option) => {
      acc[option.id] = previous[option.id] ?? initialOptions[option.id] ?? Boolean(option.defaultChecked);
      return acc;
    }, {});
  });
  const [quantity, setQuantity] = useState(1);
  const selectedVariant = variants.find((variant) => variant.id === format) || variants[0];
  const optionLink = resolveVariantOptionLink(selectedVariant, selectedExtras);
  const resolvedEntry = optionLink?.entry || selectedVariant?.entry || catalogEntry;
  const basePrice = optionLink
    ? assetUnitPrice(optionLink.entry, salonLabel)
    : (selectedVariant?.price ?? assetUnitPrice(catalogEntry, salonLabel));
  const extras = extraOptions
    .filter((option) => !selectedVariant?.optionLinks?.some((link) => link.optionId === option.id))
    .reduce((sum, option) => sum + (selectedExtras[option.id] ? Number(option.price || 0) : 0), 0);
  const total = (basePrice + extras) * (mode === 'add' ? quantity : 1);
  const hasVisualOptions = mode === 'edit' && item && (
    isPartitionHeadItem(item)
    || isPosterItem(item)
    || (isWoodReceptionDeskItem(item) && !isIncludedSceneItem(item))
  );

  const toggleExtra = (id, checked) => {
    setSelectedExtras((current) => ({ ...current, [id]: checked }));
  };

  const submit = () => {
    onConfirm({
      entry: resolvedEntry,
      item,
      quantity,
      options: {
        ...initialOptions,
        ...(isVariantGroup ? { variantGroupType: catalogEntry.type, variantGroupLabel: catalogEntry.label } : {}),
        format,
        variantId: selectedVariant?.id || format,
        variantLabel: selectedVariant?.label,
        variantDetail: selectedVariant?.detail,
        variantReference: selectedVariant?.reference,
        variantImageUrl: selectedVariant?.imageUrl,
        variantAssetType: resolvedEntry?.type || selectedVariant?.assetType,
        extraOptions: selectedExtras,
        technician: Boolean(selectedExtras.technician),
        fileCheck: Boolean(selectedExtras.fileCheck),
        unitPrice: basePrice + extras,
      },
    });
  };

  return (
    <div className="item-config-overlay">
      <section className="item-config-modal">
        <header>
          <div>
            <h2>{t(mode === 'add' ? 'item_config_add' : 'item_config_edit', { name: itemConfigTitle(catalogEntry) })}</h2>
            <span>{t('item_config_breadcrumb')} {marketCategoryMeta(normalizeMarketCategory(catalogEntry)).label} › {localizeItemLabel(catalogEntry, lang)}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={t('item_config_close')}><X size={18} /></button>
        </header>

        <div className="item-config-product">
          <span>{(optionLink?.entry?.thumbnailUrl || selectedVariant?.imageUrl || catalogEntry.thumbnailUrl) ? <img src={optionLink?.entry?.thumbnailUrl || selectedVariant?.imageUrl || catalogEntry.thumbnailUrl} alt="" /> : <Box size={34} />}</span>
          <div>
            <strong>{localizeItemLabel(catalogEntry, lang)}</strong>
            <small>{t('item_config_ref')} {assetReference(selectedVariant?.entry || catalogEntry, salonLabel) || selectedVariant?.assetType || catalogEntry.type || 'Stand-ING'}</small>
          </div>
        </div>

        <ConfigChoiceGrid title={t('item_config_variant_title')} choices={variants} value={format} onChange={setFormat} />

        {hasVisualOptions && isPartitionHeadItem(item) && (
          <PartitionHeadOptionsPanel
            item={item}
            visualContext={visualContext}
            uploadState={uploadState}
            onImageChange={(file) => onImageChange?.(item, file)}
            onResetImage={() => onUpdateItemOptions?.(item, { headMainImageUrl: '', headMainImageName: '' })}
            embedded
          />
        )}

        {hasVisualOptions && isPosterItem(item) && (
          <PosterOptionsPanel
            item={item}
            items={items}
            width={width}
            depth={depth}
            uploadState={uploadState}
            onImageChange={(file) => onImageChange?.(item, file, { urlKey: 'posterImageUrl', nameKey: 'posterImageName' })}
            onResetImage={() => onUpdateItemOptions?.(item, { posterImageUrl: '', posterImageName: '' })}
            embedded
          />
        )}

        {hasVisualOptions && isWoodReceptionDeskItem(item) && (
          <WoodReceptionDeskOptionsPanel
            item={item}
            colors={counterColors}
            uploadState={uploadState}
            onImageChange={(file) => onImageChange?.(item, file, { urlKey: 'binary3ImageUrl', nameKey: 'binary3ImageName' })}
            onResetImage={() => onUpdateItemOptions?.(item, { binary3ImageUrl: '', binary3ImageName: '' })}
            onColorChange={(color) => onUpdateItemOptions?.(item, { binary2Color: color.hex, binary2ColorImage: color.image || '', binary2ColorId: color.id, binary2ColorName: color.name, binary2ColorReference: '', binary2ColorPrice: 0 })}
            onResetColor={() => onUpdateItemOptions?.(item, { binary2Color: '', binary2ColorImage: '', binary2ColorId: '', binary2ColorName: '', binary2ColorReference: '', binary2ColorPrice: 0 })}
            embedded
            optionsFree
          />
        )}

        {extraOptions.length > 0 && (
          <div className="item-config-options">
            {extraOptions.map((option) => {
              const linkedOption = selectedVariant?.optionLinks?.find((link) => link.optionId === option.id);
              const linkedPrice = linkedOption ? assetUnitPrice(linkedOption.entry, salonLabel) : null;
              const displayPrice = linkedOption
                ? (linkedPrice != null ? `${linkedPrice.toLocaleString('fr-FR')} €` : t('item_config_included'))
                : `+ ${Number(option.price || 0).toLocaleString('fr-FR')} €`;
              return (
                <ToggleOption
                  key={option.id}
                  active={Boolean(selectedExtras[option.id])}
                  label={option.label}
                  detail={option.detail}
                  price={displayPrice}
                  onChange={(checked) => toggleExtra(option.id, checked)}
                />
              );
            })}
          </div>
        )}

        {mode === 'add' && (
          <div className="item-config-quantity">
            <span>{t('item_config_quantity')}</span>
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
            <strong>{quantity}</strong>
            <button type="button" onClick={() => setQuantity((value) => value + 1)}>+</button>
          </div>
        )}

        <footer>
          <div>
            <span>{t('item_config_total')}</span>
            <strong>{total.toLocaleString('fr-FR')} €</strong>
            {quantity > 1 && <small>{quantity} × {(basePrice + extras).toLocaleString('fr-FR')} €</small>}
          </div>
          <button type="button" disabled={uploadState?.uploading} onClick={submit}>{uploadState?.uploading ? t('item_config_uploading') : (mode === 'add' ? t('item_config_add_btn') : t('item_config_save_btn'))}</button>
        </footer>
      </section>
    </div>
  );
}

function ConfigChoiceGrid({ title, choices, value, onChange }) {
  return (
    <section className="config-choice-section">
      <h3>{title}</h3>
      <div>
        {choices.map((choice) => (
          <button key={choice.id} type="button" className={value === choice.id ? 'active' : ''} onClick={() => onChange(choice.id)}>
            {choice.imageUrl && <img src={choice.imageUrl} alt="" />}
            <strong>{choice.label}</strong>
            {choice.detail && <small>{choice.detail}</small>}
            <em>{choice.price ? `${choice.price.toLocaleString('fr-FR')} €` : 'Inclus'}</em>
            {value === choice.id && <span><Check size={12} /></span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function ToggleOption({ active, label, detail, price, onChange }) {
  return (
    <button type="button" className={`config-toggle-option ${active ? 'active' : ''}`} onClick={() => onChange(!active)}>
      <i />
      <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <em>{price}</em>
    </button>
  );
}

function itemConfigVariants(entry, salonLabel) {
  if (isVariantGroupEntry(entry)) {
    const configOptions = entry?.dimensions?.configOptions || [];
    const selectOption = configOptions.find((o) => o.type === 'select' && o.choices?.length);
    if (selectOption) {
      const variants = normalizeSelectOptionVariants(selectOption, entry?.dimensions?.variantOptionLinks || [], salonLabel);
      if (variants.length) return variants;
    }
    const groupVariants = normalizeVariantGroupOptions(
      entry?.dimensions?.variantAssets,
      salonLabel,
      entry?.dimensions?.variantOptionLinks || [],
    );
    if (groupVariants.length) return groupVariants;
  }
  return genericItemVariants(entry, salonLabel);
}

function normalizeSelectOptionVariants(selectOption, variantOptionLinks = [], salonLabel = '') {
  return (selectOption.choices || [])
    .filter((choice) => choice.entry)
    .map((choice, index) => {
      const optionLinks = variantOptionLinks
        .filter((link) => link.selectOptionId === selectOption.id && link.choiceId === choice.id && link.linkedEntry)
        .map((link) => ({ optionId: link.toggleOptionId, entry: link.linkedEntry }));
      return {
        id: choice.id,
        assetType: choice.assetType,
        label: choice.label,
        detail: assetDimensionsLabel({ dimensions: choice.entry?.dimensions }) || '',
        price: assetUnitPrice(choice.entry, salonLabel),
        reference: assetReference(choice.entry, salonLabel),
        imageUrl: choice.entry?.thumbnailUrl || '',
        isDefault: index === 0,
        optionLinks,
        entry: choice.entry,
      };
    });
}

function itemConfigExtraOptions(entry) {
  const options = (entry?.dimensions?.configOptions || []).filter((o) => (o.type || 'toggle') !== 'select');
  return normalizeAssetConfigOptions(options);
}

function entryNeedsConfigurator(entry = {}) {
  if (isVariantGroupEntry(entry)) return true;
  return itemConfigExtraOptions(entry).length > 0;
}

function resolveVariantOptionLink(variant, selectedExtras = {}) {
  if (!variant?.optionLinks?.length) return null;
  return variant.optionLinks.find((link) => Boolean(selectedExtras[link.optionId])) || null;
}

function genericItemVariants(entry, salonLabel) {
  return [{ id: 'standard', label: 'Standard', detail: 'Configuration par défaut', price: assetUnitPrice(entry, salonLabel), isDefault: true }];
}

function normalizeAssetConfigOptions(options = []) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option, index) => ({
      id: String(option.id || slugForType(option.label || `option-${index + 1}`)),
      label: option.label || `Option ${index + 1}`,
      detail: option.detail || '',
      price: Number(option.price || 0),
      defaultChecked: Boolean(option.defaultChecked),
      type: option.type || 'toggle',
      choices: option.type === 'select' ? (option.choices || []) : undefined,
    }))
    .filter((option) => option.label.trim());
}

function normalizeVariantGroupOptions(variantAssets = [], salonLabel = '', variantOptionLinks = []) {
  if (!Array.isArray(variantAssets)) return [];
  return variantAssets
    .filter((entry) => entry?.type)
    .map((entry, index) => {
      const optionLinks = variantOptionLinks
        .filter((link) => link.variantType === entry.type && link.linkedEntry)
        .map((link) => ({ optionId: link.optionId, entry: link.linkedEntry }));
      return {
        id: entry.type,
        assetType: entry.type,
        label: entry.label || `Variante ${index + 1}`,
        detail: entry.dimensions?.variantDetail || assetDimensionsLabel({ dimensions: entry.dimensions }) || '',
        price: assetUnitPrice(entry, salonLabel),
        reference: assetReference(entry, salonLabel),
        imageUrl: entry.thumbnailUrl || entry.thumbnail_url || '',
        isDefault: index === 0,
        optionLinks,
        entry,
      };
    });
}

function itemConfigTitle(entry = {}) {
  const label = entry.label || 'cet objet';
  if (/tv|télé|tele|ecran|écran|lcd/i.test(label)) return 'un téléviseur';
  return label;
}

function itemCartLabel(item) {
  return item.options?.variantLabel ? `${item.label || item.type} ${item.options.variantLabel}` : (item.label || item.type);
}

function cartItemPrice(item, entry, salonLabel) {
  const basePrice = cartItemBasePrice(item, entry, salonLabel);
  const colorSupplement = isBillableCounterColorOption(item, entry)
    ? Number(item.options?.binary2ColorPrice || 0) * counterColorSurfaceM2(item, entry)
    : 0;
  return basePrice + colorSupplement;
}

function cartItemBasePrice(item, entry, salonLabel) {
  return Number(item.options?.unitPrice ?? assetUnitPrice(entry, salonLabel) ?? 0);
}

function counterColorSurfaceM2(item = {}, entry = {}) {
  if (!item.options?.binary2ColorPrice) return 1;
  const size = itemDefaultSize({ ...entry, ...item, dimensions: { ...(entry?.dimensions || {}), ...(item?.dimensions || {}) } });
  const width = Number(size?.[0] || 1);
  const height = Number(size?.[1] || 1);
  return Math.max(1, roundM2(width * height));
}

function counterColorOptionLine(item = {}, entry = {}, salonLabel = '', index = 0) {
  const colorPrice = Number(item.options?.binary2ColorPrice || 0);
  if (!isBillableCounterColorOption(item, entry) || colorPrice <= 0) return null;
  const colorName = item.options?.binary2ColorName || item.options?.binary2Color || 'finition';
  return {
    type: `counter-color-${item.id || entry?.type || index}`,
    label: `Option finition banque d'accueil — ${colorName}`,
    quantity: 1,
    unitPrice: colorPrice,
    total: Math.round(colorPrice),
    reference: item.options?.binary2ColorReference || assetReference(entry, salonLabel),
    optionForItemId: item.id || '',
  };
}

function isBillableCounterColorOption(item = {}, entry = {}) {
  return isIncludedSceneItem(item) && isWoodReceptionDeskItem({ ...entry, ...item });
}

function marketplaceStartingPrice(entry, catalog = [], salonLabel = '') {
  if (isVariantGroupEntry(entry)) {
    const prices = normalizeVariantGroupOptions(entry.dimensions?.variantAssets, salonLabel)
      .map((variant) => Number(variant.price || 0))
      .filter((price) => price > 0);
    if (prices.length) return Math.min(...prices);
  }
  return assetUnitPrice(entry, salonLabel);
}

function variantGroupMemberTypes(catalog = []) {
  return new Set(catalog
    .filter(isVariantGroupEntry)
    .flatMap((entry) => entry.dimensions?.variantAssetTypes || [])
    .filter(Boolean));
}

function normalizeMarketCategory(entry = {}) {
  const category = furniturePanelCategory(entry);
  if (category === 'structure') return 'structure';
  if (category === 'multimedia') return 'multimedia';
  const raw = String(entry.dimensions?.category || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (raw.includes('electric')) return 'electricity';
  if (raw.includes('signal')) return 'signage';
  return 'furniture';
}

function marketCategoryMeta(id) {
  const meta = {
    all: { id: 'all', label: 'TOUS', icon: '○' },
    furniture: { id: 'furniture', label: 'Mobilier', icon: '▤' },
    multimedia: { id: 'multimedia', label: 'Multimédia', icon: '▣' },
    electricity: { id: 'electricity', label: 'Électricité', icon: '⚡' },
    signage: { id: 'signage', label: 'Signalétique', icon: '▦' },
    structure: { id: 'structure', label: 'Structures', icon: '▥' },
  };
  return meta[id] || meta.furniture;
}

function marketplaceCategories(entries) {
  const counts = entries.reduce((acc, entry) => {
    const key = normalizeMarketCategory(entry);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { all: entries.length });
  return ['all', 'furniture', 'multimedia', 'electricity', 'signage', 'structure']
    .filter((id) => id === 'all' || counts[id])
    .map((id) => ({ ...marketCategoryMeta(id), count: counts[id] || 0 }));
}

function marketplaceItemSubtitle(entry, categoryLabel) {
  if (isVariantGroupEntry(entry)) return `${entry.dimensions?.variantAssetTypes?.length || 0} variantes disponibles`;
  if (entry.dimensions?.isTelevision) return '32 / 43 / 55 / 65 pouces';
  if (entry.dimensions?.category) return entry.dimensions.category;
  return categoryLabel;
}

function shopCartItemVisible(item) {
  if (!item) return false;
  if (isAutomaticReserveItem(item)) return false;
  if (isAutomaticPartitionHeadItem(item)) return false;
  if (isAutomaticLedRailItem(item)) return false;
  if (isAutomaticSpotItem(item)) return false;
  return true;
}

function itemOptionLines(item) {
  const opts = item.options || {};
  const result = [];
  if (opts.variantLabel) result.push(opts.variantLabel);
  if (opts.posterImageName) result.push(opts.posterImageName);
  if (opts.headMainImageName && !opts.headMainImageName.startsWith('Texture originale')) result.push(opts.headMainImageName);
  if (opts.binary3ImageName && !opts.binary3ImageName.startsWith('Texture originale')) result.push(opts.binary3ImageName);
  if (opts.binary2ColorName || opts.binary2Color) {
    const colorPrice = Number(opts.binary2ColorPrice || 0);
    result.push(`Couleur : ${opts.binary2ColorName || opts.binary2Color}${colorPrice > 0 ? ` (+${colorPrice.toLocaleString('fr-FR')} € HT/m²)` : ''}`);
  }
  if (opts.technician) result.push('Technicien inclus');
  if (opts.fileCheck) result.push('Vérification fichier');
  return result;
}

function ValidationStepPanel({
  area,
  layout,
  standLabel,
  carpetColor,
  carpetFootprintColor,
  carpetFootprintEnabled,
  wallFabricColor,
  technicalFloor,
  technicalFloorTrimType,
  ledRailsEnabled,
  ledSpotCount,
  reserveRule,
  reserveOptionType,
  partitionHeadRule,
  partitionHeadSides,
  pricing,
  items = [],
  catalog = [],
  saveState,
  confirmState,
  readOnly,
  isAdminViewer,
  onConfirm,
}) {
  const t = useT();
  const lines = pricing?.lines || [];
  const baseItems = pricing?.baseUsage || pricing?.baseItems || [];
  const includedCounts = pricing?.includedCounts || new Map();
  const confirmed = saveState === 'configured';
  const reserveOption = reserveOptionType ? normalizeComplementaryOptions(reserveRule?.options).find((option) => option.type === reserveOptionType) : null;

  return (
    <>
      <PanelHead title={t('panel_validation_title')} step={4} />

      <section className="validation-summary-card">
        <h2>{t('validation_summary_title')}</h2>
        <div className="validation-total-line">
          <span>{t('validation_total_label')}</span>
          <strong>{(pricing?.total || 0).toLocaleString('fr-FR')} € HT</strong>
        </div>
        <p>{t('validation_total_note')}</p>
      </section>

      <section className="validation-section">
        <h3>{t('validation_options_title')}</h3>
        <div className="validation-option-row"><span>{t('validation_carpet')}</span><strong>{carpetColor.name} ({carpetColor.code})</strong></div>
        <div className="validation-option-row"><span>{t('validation_footprint')}</span><strong>{carpetFootprintEnabled ? `${carpetFootprintColor.name} (${carpetFootprintColor.code})` : t('validation_footprint_removed')}</strong></div>
        <div className="validation-option-row"><span>{t('validation_wall')}</span><strong>{wallFabricColor.name} ({wallFabricColor.code})</strong></div>
        <div className="validation-option-row"><span>{t('validation_floor')}</span><strong>{technicalFloor ? `${technicalFloor.label} · ${technicalTrimLabel(technicalFloorTrimType)} · rampe obligatoire` : t('validation_floor_none')}</strong></div>
        <div className="validation-option-row"><span>{t('validation_led')}</span><strong>{ledRailsEnabled ? t('validation_led_kept', { count: ledSpotCount }) : t('validation_led_removed')}</strong></div>
        <div className="validation-option-row"><span>{t('validation_reserve')}</span><strong>{reserveOptionType === '__none__' ? t('validation_reserve_removed') : (reserveOption?.label || reserveRule?.includedLabel || t('validation_reserve_none'))}</strong></div>
        <div className="validation-option-row"><span>{t('validation_partition_heads')}</span><strong>{partitionHeadSummary(partitionHeadRule, partitionHeadSides)}</strong></div>
      </section>

      <section className="validation-section">
        <h3>{t('validation_base_items_title')}</h3>
        {baseItems.length ? (
          baseItems.map((bu) => {
            const typeItems = items.filter((i) => i.type === bu.type).slice(0, bu.used ?? bu.quantity);
            return (
              <div key={bu.type}>
                <div className="validation-option-row">
                  <span>{basePackItemLabel(bu.label, bu.quantity)}</span>
                  <strong>{bu.used ?? 0}/{bu.quantity}</strong>
                </div>
                {typeItems.map((item) => {
                  const optLines = itemOptionLines(item);
                  if (!optLines.length) return null;
                  return (
                    <div key={item.id} className="validation-item-options">
                      {optLines.map((line, i) => <span key={i}>{line}</span>)}
                    </div>
                  );
                })}
              </div>
            );
          })
        ) : (
          <p className="validation-muted">{t('validation_no_base_items')}</p>
        )}
      </section>

      <section className="validation-section">
        <h3>{t('validation_supplements_title')}</h3>
        {lines.length ? (
          lines.map((line) => {
            const includedCount = includedCounts.get(line.type) || 0;
            const billableItems = items.filter((i) => i.type === line.type).slice(includedCount);
            return (
              <div key={line.type}>
                <div className="validation-price-row">
                  <span>{line.label} × {line.quantity}</span>
                  <strong>{line.total.toLocaleString('fr-FR')} € HT</strong>
                </div>
                {billableItems.map((item) => {
                  const optLines = itemOptionLines(item);
                  if (!optLines.length) return null;
                  return (
                    <div key={item.id} className="validation-item-options">
                      {optLines.map((opt, i) => <span key={i}>{opt}</span>)}
                    </div>
                  );
                })}
              </div>
            );
          })
        ) : (
          <p className="validation-muted">{t('validation_no_supplements')}</p>
        )}
      </section>

      {confirmState.message && <div className="validation-message success">{confirmState.message}</div>}
      {confirmState.error && <div className="validation-message error">{confirmState.error}</div>}

      {confirmed && (
        <div className="validation-message success"><Check size={16} /> {t('validation_confirmed_note')}</div>
      )}
      <button className="validation-confirm-button" type="button" disabled={confirmState.loading} onClick={onConfirm}>
        {confirmState.loading ? t('validation_confirm_loading') : confirmed ? t('validation_confirm_update') : t('validation_confirm_btn')}
      </button>
    </>
  );
}

function basePackUsageText(item) {
  return `Pack de base : ${basePackItemLabel(item.label, item.quota)} ${basePackIncludedWord(item.label, item.quota)} ${item.count}/${item.quota}`;
}

function basePackIncludedWord(label = '', quantity = 1) {
  const feminine = String(label).trim().toLowerCase().endsWith('e');
  if (Number(quantity || 0) > 1) return feminine ? 'comprises' : 'compris';
  return feminine ? 'comprise' : 'compris';
}

function basePackItemLabel(label = 'Objet', quantity = 1) {
  if (Number(quantity || 0) <= 1) return label;
  if (/\d|["”]/.test(label)) return label;
  if (/[sx]$/i.test(label)) return label;
  return `${label}s`;
}

function PanelHead({ title, step }) {
  const t = useT();
  return (
    <div className="config-panel-head">
      <h1>{title}</h1>
      <span>{t('panel_step', { step })}</span>
    </div>
  );
}

function RulesSummary({ ledSpotCount, ledRailsEnabled, reserveRule, partitionHeadRule }) {
  const t = useT();
  const headCount = partitionHeadRule?.includedCount || 0;
  return (
    <div className="rules-card">
      <strong>{t('rules_title')}</strong>
      <span>{reserveRule?.includedType ? '✓' : '−'} {reserveRule?.includedLabel || t('rules_no_reserve')}</span>
      <span>✓ {headCount} {t('rules_head', { count: headCount, s: headCount > 1 ? 's' : '' })}</span>
      <span>{ledRailsEnabled ? '✓' : '−'} {t('rules_led', { count: ledSpotCount })}</span>
    </div>
  );
}

function FurnitureCatalogSection({ title, entries, counts, salonLabel, readOnly = false, onAdd, onRemove }) {
  if (!entries.length) return null;
  return (
    <section className="furniture-panel-section">
      <h2>{title}</h2>
      <div className="furniture-catalog-list">
        {entries.map((entry) => (
          <FurnitureCatalogRow
            key={entry.type}
            entry={entry}
            count={counts.get(entry.type) || 0}
            salonLabel={salonLabel}
            readOnly={readOnly}
            onAdd={() => onAdd(entry)}
            onRemove={() => onRemove(entry.type)}
          />
        ))}
      </div>
    </section>
  );
}

function FurnitureCatalogRow({ entry, count, salonLabel, readOnly = false, onAdd, onRemove }) {
  const Icon = entry.icon || Box;
  return (
    <article className={`furniture-catalog-row ${count > 0 ? 'selected' : ''}`}>
      <span className="furniture-thumb">
        {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <Icon size={24} />}
      </span>
      <div>
        <strong>{entry.label}</strong>
        <em>{formatFurniturePrice(entry, salonLabel)}</em>
      </div>
      <div className="quantity-control">
        <button type="button" onClick={onRemove} disabled={readOnly || count <= 0}>−</button>
        <span>{count}</span>
        <button type="button" onClick={onAdd} disabled={readOnly}>+</button>
      </div>
      <button type="button" className={`row-add-button ${count > 0 ? 'active' : ''}`} onClick={onAdd} disabled={readOnly}>
        {count > 0 ? <Check size={14} /> : <Plus size={14} />}
      </button>
    </article>
  );
}

function OptionAccordion({ title, icon, open, onToggle, children }) {
  return (
    <section className={`option-accordion ${open ? 'open' : ''}`}>
      <button type="button" onClick={onToggle}>
        <span>{icon}{title}</span>
        <ChevronUp size={18} />
      </button>
      {open && children}
    </section>
  );
}

function LedRailOptionCard({ enabled, spotCount, disabled = false, onChange }) {
  const t = useT();
  return (
    <div className="led-option-card">
      <div>
        <strong>{t('led_title')}</strong>
        <span>{t('led_count', { count: spotCount })}</span>
      </div>
      <div className="led-option-actions">
        <button
          type="button"
          className={enabled ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(true)}
        >
          {t('led_keep')}
        </button>
        <button
          type="button"
          className={!enabled ? 'active danger' : ''}
          disabled={disabled}
          onClick={() => onChange(false)}
        >
          {t('led_remove')}
        </button>
      </div>
      <small>{t('led_note')}</small>
    </div>
  );
}

function TechnicalFloorOptionCard({ floorType, trimType, area, layout, disabled = false, onFloorType, onTrimType }) {
  const t = useT();
  const selectedFloor = technicalFloorOptions.find((option) => option.id === floorType) || null;
  const openEdges = openTechnicalFloorEdges(layout);
  const estimated = selectedFloor ? Math.round(Number(area || 0) * selectedFloor.price) : 0;

  return (
    <div className="technical-floor-card">
      <div className="technical-floor-info">
        <span><b>!</b> {t('floor_warning')}</span>
      </div>

      <strong className="technical-floor-title">{t('floor_choose_height')}</strong>
      <div className="technical-floor-choices">
        <button type="button" className={!floorType ? 'active' : ''} disabled={disabled} onClick={() => onFloorType('')}>
          <span className="reserve-choice-radio" aria-hidden="true">{!floorType ? <span /> : null}</span>
          <span><strong>{t('floor_none')}</strong><small>{t('floor_none_detail')}</small></span>
          <em>{t('floor_included')}</em>
        </button>
        {technicalFloorOptions.map((option) => {
          const active = floorType === option.id;
          return (
            <button key={option.id} type="button" className={active ? 'active' : ''} disabled={disabled} onClick={() => onFloorType(option.id)}>
              <span className="reserve-choice-radio" aria-hidden="true">{active ? <span /> : null}</span>
              <span><strong>{option.label.replace('Plancher technique ', '')}</strong><small>{option.detail}</small></span>
              <em>{option.price} € HT/m²</em>
            </button>
          );
        })}
      </div>

      {selectedFloor && (
        <>
          <div className="technical-floor-detail">
            <strong>{selectedFloor.reference}</strong>
            <span>{formatNumber(area)} m² × {selectedFloor.price} € HT/m² = {estimated.toLocaleString('fr-FR')} € HT</span>
            <small>{t('floor_open_edges')} {openEdges.map(technicalFloorEdgeLabel).join(', ')}</small>
          </div>
          <div className="technical-floor-actions">
            <span>{t('floor_trim_type')}</span>
            {technicalTrimOptions.map((option) => (
              <button key={option.id} type="button" className={trimType === option.id ? 'active' : ''} disabled={disabled} onClick={() => onTrimType(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="technical-floor-ramp-required">
            <span>
              <strong>{t('floor_ramp_title')}</strong>
              <small>{selectedFloor.rampLabel} · {t('floor_ramp_detail')}</small>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ReserveOptionCard({ rule, selectedOptionType = '', catalog = [], salonLabel = '', disabled = false, onChange }) {
  const t = useT();
  const [formulaOpen, setFormulaOpen] = useState(false);
  const rows = reserveChoiceRows(rule, catalog, salonLabel);
  const includedRow = rows.find((row) => row.included) || null;
  const noneSelected = selectedOptionType === '__none__';

  if (!rule?.includedType && !rows.length) {
    return (
      <div className="reserve-choice-panel">
        <FormulaIncludedBox open={formulaOpen} onToggle={() => setFormulaOpen((current) => !current)} includedRow={null} />
        <div className="reserve-empty-card">
          <strong>{t('reserve_empty_title')}</strong>
          <span>{t('reserve_empty_detail')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="reserve-choice-panel">
      <FormulaIncludedBox open={formulaOpen} onToggle={() => setFormulaOpen((current) => !current)} includedRow={includedRow} />
      <strong className="reserve-choice-title">{t('reserve_choose_size')}</strong>
      <div className="reserve-choice-list">
        {rows.map((row) => {
          const selected = !noneSelected && (row.included ? !selectedOptionType : selectedOptionType === row.type);
          return (
            <button
              key={row.key}
              type="button"
              className={selected ? 'reserve-choice-card active' : 'reserve-choice-card'}
              disabled={disabled}
              onClick={() => onChange(row.included ? '' : (selected && !rule?.includedType ? '' : row.type))}
            >
              <span className="reserve-choice-radio" aria-hidden="true">{selected ? <span /> : null}</span>
              <span className="reserve-choice-copy">
                <strong>{row.sizeName} <b>{row.areaLabel}</b></strong>
                <small>{row.description}</small>
              </span>
              <span className={row.included ? 'reserve-choice-price included' : 'reserve-choice-price'}>
                {row.included ? t('reserve_included') : `+ ${row.price.toLocaleString('fr-FR')} € HT`}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={noneSelected ? 'reserve-remove-button active' : 'reserve-remove-button'}
        disabled={disabled || (!rule?.includedType && !selectedOptionType)}
        onClick={() => onChange(noneSelected ? '' : '__none__')}
      >
        <X size={15} /> {t('reserve_remove')}
      </button>
    </div>
  );
}

function FormulaIncludedBox({ open, onToggle, includedRow }) {
  const t = useT();
  return (
    <div className={open ? 'formula-included-box open' : 'formula-included-box'}>
      <button type="button" onClick={onToggle}>
        <span><b>!</b> {t('formula_title')}</span>
        {open ? <Minus size={16} /> : <Plus size={16} />}
      </button>
      {open && (
        <div>
          {includedRow ? (
            <>
              <p>{t('formula_reserve_included', { area: includedRow.areaLabel })}</p>
              <p>{t('formula_reserve_detail')}</p>
            </>
          ) : (
            <p>{t('formula_reserve_none')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function reserveChoiceRows(rule, catalog = [], salonLabel = '') {
  const rows = [];
  if (rule?.includedType) {
    const entry = findCatalogEntry(catalog, rule.includedType);
    rows.push(reserveChoiceRow({ type: rule.includedType, label: rule.includedLabel, entry, included: true, price: 0 }));
  }

  normalizeComplementaryOptions(rule?.options || []).forEach((option) => {
    const entry = findCatalogEntry(catalog, option.type);
    rows.push(reserveChoiceRow({
      type: option.type,
      label: option.label,
      entry,
      included: false,
      price: reserveOptionPrice(option, entry, salonLabel),
    }));
  });

  return rows
    .filter((row, index, list) => row.type && list.findIndex((item) => item.type === row.type) === index)
    .sort((a, b) => a.area - b.area || Number(b.included) - Number(a.included));
}

function reserveChoiceRow({ type, label, entry, included = false, price = 0 }) {
  const fullLabel = label || entry?.label || 'Réserve';
  const area = reserveAreaFromText(`${fullLabel} ${type}`);
  return {
    key: included ? `included-${type}` : `option-${type}`,
    type,
    included,
    price: Math.max(0, Number(price || 0)),
    area,
    areaLabel: area ? `${formatAreaValue(area)} m²` : '',
    sizeName: reserveSizeName(area, fullLabel),
    description: reserveSizeDescription(area, fullLabel),
    recommended: area >= 1.75 && area <= 2.5,
  };
}

function reserveAreaFromText(text = '') {
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(',', '.');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*m\s*(?:2|²|carre|²)?/);
  if (match) return Number(match[1]);
  const compact = normalized.match(/(\d+(?:\.\d+)?)m2/);
  return compact ? Number(compact[1]) : 0;
}

function formatAreaValue(value = 0) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function reserveSizeName(area = 0, label = '') {
  const text = normalizeTextValue(label);
  if (text.includes('petite')) return 'Petite';
  if (text.includes('standard')) return 'Standard';
  if (text.includes('grande')) return 'Grande';
  if (area && area <= 1.25) return 'Petite';
  if (area && area <= 2.5) return 'Standard';
  return 'Grande';
}

function reserveSizeDescription(area = 0, label = '') {
  if (area && area <= 1.25) return '1m × 1m · 1 personne';
  if (area && area <= 2.5) return '1m × 2m · idéale petits salons';
  if (area) return '2m × 2m · bagages + sacs équipe';
  return label || 'Réserve complémentaire';
}

function PartitionHeadOptionCard({ rule, sides = {}, catalog = [], salonLabel = '', disabled = false, visualOptions = {}, uploadState = {}, onChange, onImage, onResetImage }) {
  const t = useT();
  const [formulaOpen, setFormulaOpen] = useState(true);
  const rows = [
    { side: 'left', label: t('partition_left'), visualLabel: t('partition_left'), type: rule?.leftType, price: rule?.leftPrice },
    { side: 'right', label: t('partition_right'), visualLabel: t('partition_right'), type: rule?.rightType, price: rule?.rightPrice },
  ];
  const selectedRows = rows.filter((row) => Boolean(sides?.[row.side]));
  const selectedCount = selectedRows.length;

  return (
    <div className="partition-head-panel">
      <PartitionHeadFormulaBox open={formulaOpen} onToggle={() => setFormulaOpen((current) => !current)} />

      <div className="partition-head-choice-grid">
        {rows.map((row) => {
          const entry = findCatalogEntry(catalog, row.type);
          const selected = Boolean(sides?.[row.side]);
          const currentSelectedCount = Object.values(sides).filter(Boolean).length;
          const freeSlots = Math.max(0, Number(rule?.includedCount || 0));
          const billableSides = partitionHeadBillableSides(rule, sides);
          const billable = selected ? billableSides.has(row.side) : currentSelectedCount >= freeSlots;
          const price = billable ? firstPriceValue(row.price, assetUnitPrice(entry, salonLabel), 0) : 0;
          return (
            <button
              key={row.side}
              type="button"
              className={selected ? 'partition-head-side-card active' : 'partition-head-side-card'}
              disabled={disabled || !row.type}
              onClick={() => onChange(row.side, !selected)}
            >
              <span className="reserve-choice-radio" aria-hidden="true">{selected ? <span /> : null}</span>
              <span>
                <strong>{row.label}</strong>
                <small>{row.type ? (billable ? `+ ${price.toLocaleString('fr-FR')} € HT` : t('color_included')) : t('partition_not_configured')}</small>
              </span>
            </button>
          );
        })}
      </div>

      {selectedRows.length ? selectedRows.map((row) => (
        <PartitionHeadVisualUpload
          key={row.side}
          row={row}
          visual={visualOptions?.[row.side] || {}}
          uploading={uploadState?.uploading === row.side}
          disabled={disabled}
          onImage={(file) => onImage?.(row.side, file)}
          onReset={() => onResetImage?.(row.side)}
        />
      )) : (
        <div className="partition-head-empty">{t('partition_select_visual')}</div>
      )}
      {uploadState?.error && <small className="partition-head-upload-error">{uploadState.error}</small>}

      <button
        type="button"
        className="partition-head-remove-button"
        disabled={disabled || !selectedCount}
        onClick={() => {
          onChange('left', false);
          onChange('right', false);
        }}
      >
        <X size={15} /> {t('partition_remove')}
      </button>
    </div>
  );
}

function PartitionHeadFormulaBox({ open, onToggle }) {
  const t = useT();
  return (
    <div className={open ? 'formula-included-box partition-head-formula open' : 'formula-included-box partition-head-formula'}>
      <button type="button" onClick={onToggle}>
        <span><b>!</b> {t('formula_title')}</span>
        {open ? <Minus size={16} /> : <Plus size={16} />}
      </button>
      {open && (
        <div>
          <p>{t('partition_formula_detail1')}</p>
          <p>{t('partition_formula_detail2')}</p>
        </div>
      )}
    </div>
  );
}

function PartitionHeadVisualUpload({ row, visual = {}, uploading = false, disabled = false, onImage, onReset }) {
  const t = useT();
  const hasImage = Boolean(visual.headMainImageUrl);
  return (
    <div className="partition-head-upload-block">
      <div className="partition-head-upload-title">
        <strong>{row.visualLabel}</strong>
        <span>{t('partition_size')}</span>
      </div>
      <label className={hasImage ? 'partition-head-dropzone has-image' : 'partition-head-dropzone'}>
        {hasImage ? <img src={visual.headMainImageUrl} alt={row.visualLabel} /> : <FileImage size={24} />}
        <strong>{uploading ? t('partition_uploading') : t('partition_upload_drag')}</strong>
        <span>{t('partition_browse')}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || uploading}
          onChange={(event) => {
            onImage?.(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      {visual.headMainImageName && <small className="partition-head-file-name">{visual.headMainImageName}</small>}
      {hasImage && onReset && (
        <button className="item-image-reset" type="button" disabled={disabled} onClick={onReset}>
          {t('img_upload_reset')}
        </button>
      )}
    </div>
  );
}

function ToggleOptionCard({ enabled, enabledLabel, disabledLabel, disabled = false, onChange }) {
  return (
    <div className="toggle-option-card">
      <button
        type="button"
        className={enabled ? 'active' : ''}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        {enabledLabel}
      </button>
      <button
        type="button"
        className={!enabled ? 'active danger' : ''}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        {disabledLabel}
      </button>
    </div>
  );
}

function ColorOptionCard({ title, colors, selectedColor, defaultColorId = '', includedLabel = 'Inclus', optionLabel, disabled = false, onSelect }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const displayColors = colors.map((color) => colorWithDefaultIncluded(color, defaultColorId));
  const selectedDisplayColor = colorWithDefaultIncluded(selectedColor, defaultColorId);
  const includedColors = displayColors.filter((color) => color.included);
  const optionalColors = displayColors.filter((color) => !color.included);
  const selectColor = (colorId) => {
    if (disabled) return;
    onSelect(colorId);
    setDropdownOpen(false);
  };

  return (
    <div className="color-option-card">
      <div className="color-card-head">
        <strong>{title}</strong>
        <span>{selectedDisplayColor.name} ({selectedDisplayColor.code})</span>
      </div>
      <div className={`color-dropdown ${dropdownOpen ? 'open' : ''}`}>
        <button className="color-dropdown-trigger" type="button" disabled={disabled} onClick={() => setDropdownOpen((open) => !open)}>
          <span className="selected-swatch" style={{ '--swatch-color': selectedDisplayColor.hex, '--swatch-image': `url("${selectedDisplayColor.image}")` }} />
          <span>
            <strong>{selectedDisplayColor.name}</strong>
            <small>{selectedDisplayColor.code} · {selectedDisplayColor.included ? includedLabel : colorOptionLabel(selectedDisplayColor, optionLabel)}</small>
          </span>
          <ChevronDown size={18} />
        </button>
        {dropdownOpen && (
          <div className="color-dropdown-menu">
            <small>{includedColors.length} couleur{includedColors.length > 1 ? 's' : ''} — {includedLabel}</small>
            <div className="color-swatch-row included">
              {includedColors.map((color) => (
                <button
                  key={color.id}
                  className={selectedDisplayColor.id === color.id ? 'active' : ''}
                  type="button"
                  style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                  title={`${color.name} (${color.code})`}
                  disabled={disabled}
                  onClick={() => selectColor(color.id)}
                >
                  <span>{color.name}</span>
                </button>
              ))}
            </div>
            <small>{optionLabel}</small>
            <div className="color-swatch-row optional">
              {optionalColors.map((color) => (
                <button
                  key={color.id}
                  className={selectedDisplayColor.id === color.id ? 'active' : ''}
                  type="button"
                  style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                  title={`${color.name} (${color.code})`}
                  disabled={disabled}
                  onClick={() => selectColor(color.id)}
                >
                  <span>{color.name}</span>
                  <em>{colorOptionLabel(color, optionLabel)}</em>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WallCoverOptionCard({ surfaces = [], covers = {}, uploadState = {}, disabled = false, onToggle, onImage }) {
  const t = useT();
  const activeCount = surfaces.filter((surface) => covers?.[surface.id]?.enabled).length;

  return (
    <div className="wall-cover-card">
      <div className="wall-cover-head">
        <div>
          <strong>{t('wall_cover_title')}</strong>
          <span>{t('wall_cover_price')}</span>
        </div>
        <em>{activeCount} / {surfaces.length} {t('wall_cover_active')}</em>
      </div>

      {!surfaces.length && (
        <div className="wall-cover-empty">{t('wall_cover_empty')}</div>
      )}

      {surfaces.map((surface) => {
        const cover = covers?.[surface.id] || {};
        const enabled = Boolean(cover.enabled);
        const hasImage = Boolean(cover.imageUrl);
        const spec = recommendedSimulatorImageSpec(surface.visibleWidth || surface.width, surface.height, 2048);
        return (
          <div key={surface.id} className={`wall-cover-row ${enabled ? 'active' : ''} ${enabled && !hasImage ? 'needs-image' : ''}`}>
            <button
              type="button"
              className={`wall-cover-toggle ${enabled ? 'active' : ''}`}
              disabled={disabled}
              aria-label={t(enabled ? 'wall_cover_toggle_remove' : 'wall_cover_toggle_add', { label: surface.label })}
              onClick={() => onToggle?.(surface.id, !enabled)}
            >
              <span />
            </button>
            <div>
              <strong>{surface.label}</strong>
              <span>{formatNumber(surface.visibleWidth || surface.width)} m × {formatNumber(surface.height)} m</span>
              <small>{t('wall_cover_spec')} {spec.pixelText}</small>
            </div>
            <label className={`wall-cover-upload ${hasImage ? 'ready' : 'missing'}`}>
              {uploadState.uploading === surface.id ? t('img_uploading') : hasImage ? t('wall_cover_ready') : t('wall_cover_missing')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled || uploadState.uploading === surface.id}
                onChange={(event) => {
                  onImage?.(surface.id, event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        );
      })}

      {uploadState.error && <p className="wall-cover-error">{uploadState.error}</p>}
    </div>
  );
}

function CarpetColorOptionCard({ colors, selectedColor, defaultColorId = '', area = 0, disabled = false, configOptions = [], selectedOptions = {}, thick = false, onSelect, onOptionToggle, onThickChange }) {
  const t = useT();
  const displayColors = colors.map((color) => colorWithDefaultIncluded(color, defaultColorId));
  const selectedDisplayColor = colorWithDefaultIncluded(selectedColor, defaultColorId);
  const includedColors = displayColors.filter((color) => color.included);
  const optionalGroups = colorGroupsFromOptions(displayColors.filter((color) => !color.included));
  const defaultColor = displayColors.find((color) => normalizeColorId(color.id) === normalizeColorId(defaultColorId))
    || includedColors[0]
    || selectedDisplayColor;
  const includedGroupLabel = colorGroupTitle(defaultColor?.groupLabel || includedColors[0]?.groupLabel, 'Moquette Rewind');
  const selectColor = (colorId) => {
    if (disabled) return;
    onSelect(colorId);
  };

  return (
    <div className="carpet-choice-card">
      {defaultColor && (
        <div className="carpet-locked-notice">
          <strong>!</strong>
          <span>{t('carpet_locked', { color: defaultColor.name?.toLowerCase() || 'gris clair' })}</span>
          <em>—</em>
        </div>
      )}

      <section className="carpet-choice-section">
        <div className="carpet-choice-head">
          <h4>{includedGroupLabel}</h4>
          <strong>{selectedDisplayColor.name} ({selectedDisplayColor.code})</strong>
        </div>
        <small>{t('carpet_included_count', { count: includedColors.length || 1, s: (includedColors.length || 1) > 1 ? 's' : '' })}</small>
        <div className="carpet-swatch-row">
          {(includedColors.length ? includedColors : [defaultColor]).filter(Boolean).map((color) => (
            <button
              key={color.id}
              type="button"
              className={selectedDisplayColor.id === color.id ? 'active' : ''}
              style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
              title={`${color.name} (${color.code})`}
              disabled={disabled}
              onClick={() => selectColor(color.id)}
            >
              <span>{color.name}</span>
            </button>
          ))}
          <b>{t('color_included')}</b>
        </div>
        {dirtyCarpetColorCodes.includes(selectedDisplayColor.code) && (
          <div className="carpet-locked-notice footprint-warning">
            <strong>!</strong>
            <span>{t('carpet_dirty_warning')}</span>
          </div>
        )}
      </section>

      {!!optionalGroups.length && <div className="carpet-choice-separator"><span />{t('carpet_or')}<span /></div>}

      {optionalGroups.map((group) => {
        const minPrice = Math.min(...group.colors.map((color) => Number(color.price || 0)).filter((price) => price > 0));
        const price = Number.isFinite(minPrice) ? minPrice : 0;
        const selectedInGroup = group.colors.some((color) => selectedDisplayColor.id === color.id);
        return (
          <section key={group.id} className={`carpet-choice-section premium ${selectedInGroup ? 'active' : ''}`}>
            <div className="carpet-choice-head">
              <h4>{colorGroupTitle(group.label, 'Moquette épaisse Salsa')}</h4>
              <span>{t('carpet_premium')}</span>
            </div>
            <p>{carpetGroupDescription(group.label)}</p>
            <div className="carpet-premium-facts">
              <span>{t('carpet_velvet')}</span>
              <span>{t('carpet_dense')}</span>
              <span>◆ {group.colors.length} coloris</span>
            </div>
            <div className="carpet-premium-price">
              <span>{t('carpet_starting', { price: formatNumber(price) })}</span>
              <em>{t('carpet_for_area', { area: formatNumber(area), extra: formatNumber(Math.round(price * Number(area || 0))) })}</em>
            </div>
            <div className="carpet-swatch-row premium">
              {group.colors.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={selectedDisplayColor.id === color.id ? 'active' : ''}
                  style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                  title={`${color.name} (${color.code}) · ${colorOptionLabel(color, 'Option')}`}
                  disabled={disabled}
                  onClick={() => selectColor(color.id)}
                >
                  <span>{color.name}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <div className="carpet-config-options">
        <ToggleOption
          active={thick}
          label={t('carpet_thick_label')}
          detail={t('carpet_thick_detail')}
          price={`+ 30 €/m² (+${Math.round(30 * Number(area || 0)).toLocaleString('fr-FR')} €)`}
          onChange={(v) => onThickChange?.(v)}
        />
        {configOptions.map((option) => (
          <ToggleOption
            key={option.id}
            active={Boolean(selectedOptions[option.id])}
            label={option.label}
            detail={option.detail}
            price={`+ ${Number(option.price || 0).toLocaleString('fr-FR')} €`}
            onChange={(checked) => onOptionToggle?.(option.id, checked)}
          />
        ))}
      </div>
    </div>
  );
}

function FootprintColorOptionCard({ enabled, colors, selectedColor, defaultColorId = '', area = 1, disabled = false, disabledReason = '', thick = false, onEnabledChange, onSelect, onThickChange }) {
  const t = useT();
  const displayColors = colors.map((color) => colorWithDefaultIncluded(color, defaultColorId));
  const selectedDisplayColor = colorWithDefaultIncluded(selectedColor, defaultColorId);
  const groups = colorGroupsFromOptions(displayColors);
  const standardGroups = groups.filter((group) => group.colors.some((color) => color.included));
  const premiumGroups = groups.filter((group) => !group.colors.some((color) => color.included));
  const visibleStandardGroups = standardGroups.length ? standardGroups : groups.slice(0, 1);
  const visiblePremiumGroups = standardGroups.length ? premiumGroups : groups.slice(1);
  const selectColor = (colorId) => {
    if (disabled || !enabled) return;
    onSelect(colorId);
  };

  return (
    <div className={`carpet-choice-card footprint-choice-card ${!enabled ? 'disabled' : ''}`}>
      {!enabled && (
        <div className="footprint-disabled-note">
          <span>{disabledReason || t('footprint_disabled')}</span>
          <button type="button" disabled={disabled} onClick={() => onEnabledChange(true)}>{t('footprint_restore')}</button>
        </div>
      )}

      {visibleStandardGroups.map((group) => {
        const includedColors = group.colors.filter((color) => color.included);
        const paidColors = group.colors.filter((color) => !color.included);
        const selectedInGroup = group.colors.some((color) => selectedDisplayColor.id === color.id);
        const referenceColor = selectedInGroup ? selectedDisplayColor : includedColors[0] || group.colors[0];
        const minPrice = minColorPrice(paidColors);
        return (
          <section key={group.id} className="carpet-choice-section footprint-standard">
            <div className="carpet-choice-head">
              <h4>{colorGroupTitle(group.label, 'Moquette Rewind')}</h4>
              <strong>{referenceColor?.name} ({referenceColor?.code})</strong>
            </div>
            <small>{t('carpet_included_count', { count: includedColors.length || 1, s: (includedColors.length || 1) > 1 ? 's' : '' })}</small>
            <div className="carpet-swatch-row">
              {(includedColors.length ? includedColors : [referenceColor]).filter(Boolean).map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={selectedDisplayColor.id === color.id ? 'active' : ''}
                  style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                  title={`${color.name} (${color.code})`}
                  disabled={disabled || !enabled}
                  onClick={() => selectColor(color.id)}
                >
                  <span>{color.name}</span>
                </button>
              ))}
            </div>
            {!!paidColors.length && (
              <>
                {dirtyCarpetColorCodes.includes(selectedDisplayColor.code) && (
                  <div className="carpet-locked-notice footprint-warning">
                    <strong>!</strong>
                    <span>{t('carpet_dirty_warning')}</span>
                  </div>
                )}
                <small>{t('carpet_option_from', { price: formatNumber(minPrice) })}</small>
                <div className="carpet-swatch-row premium">
                  {paidColors.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      className={selectedDisplayColor.id === color.id ? 'active' : ''}
                      style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                      title={`${color.name} (${color.code}) · ${colorOptionLabel(color, 'Option')}`}
                      disabled={disabled || !enabled}
                      onClick={() => selectColor(color.id)}
                    >
                      <span>{color.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}

      {!!visiblePremiumGroups.length && <div className="carpet-choice-separator"><span />{t('carpet_or')}<span /></div>}

      {visiblePremiumGroups.map((group) => {
        const price = minColorPrice(group.colors);
        const selectedInGroup = group.colors.some((color) => selectedDisplayColor.id === color.id);
        return (
          <section key={group.id} className={`carpet-choice-section premium ${selectedInGroup ? 'active' : ''}`}>
            <div className="carpet-choice-head">
              <h4>{colorGroupTitle(group.label, 'Moquette épaisse Salsa')}</h4>
              <span>{t('carpet_premium')}</span>
            </div>
            <p>{carpetGroupDescription(group.label)}</p>
            <div className="carpet-premium-facts">
              <span>{t('carpet_velvet')}</span>
              <span>{t('carpet_dense')}</span>
              <span>◆ {group.colors.length} coloris</span>
            </div>
            <div className="carpet-premium-price">
              <span>{t('carpet_starting', { price: formatNumber(price) })}</span>
              <em>{Number(area || 0) > 1 ? t('carpet_for_area', { area: formatNumber(area), extra: formatNumber(Math.round(price * Number(area || 0))) }) : ''}</em>
            </div>
            <div className="carpet-swatch-row premium">
              {group.colors.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={selectedDisplayColor.id === color.id ? 'active' : ''}
                  style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }}
                  title={`${color.name} (${color.code}) · ${colorOptionLabel(color, 'Option')}`}
                  disabled={disabled || !enabled}
                  onClick={() => selectColor(color.id)}
                >
                  <span>{color.name}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <div className="carpet-config-options">
        <ToggleOption
          active={thick}
          label={t('carpet_thick_label')}
          detail={t('carpet_thick_detail')}
          price={`+ 30 €/m² (+${Math.round(30 * Number(area || 0)).toLocaleString('fr-FR')} €)`}
          onChange={(v) => onThickChange?.(v)}
        />
      </div>

      {enabled && (
        <button className="footprint-remove-button" type="button" disabled={disabled} onClick={() => onEnabledChange(false)}>
          {t('footprint_remove')}
        </button>
      )}
    </div>
  );
}

function colorOptionLabel(color = {}, fallback = 'En option') {
  const price = Number(color.price || 0);
  const reference = color.reference || color.groupLabel || '';
  const priceText = price > 0 ? `+${price.toLocaleString('fr-FR')} € HT/m²` : fallback;
  return reference ? `${priceText} · ${reference}` : priceText;
}

function colorGroupsFromOptions(colors = []) {
  const groups = new Map();
  colors.forEach((color) => {
    const id = color.groupId || color.groupLabel || 'colors';
    if (!groups.has(id)) groups.set(id, { id, label: color.groupLabel || 'Options payantes', colors: [] });
    groups.get(id).colors.push(color);
  });
  return [...groups.values()];
}

function minColorPrice(colors = []) {
  const prices = colors.map((color) => Number(color.price || 0)).filter((price) => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function colorGroupTitle(label = '', fallback = '') {
  if (!label) return fallback;
  return String(label).replace(/^pack\s+/i, '').replace(/^groupe\s+/i, '').trim() || fallback;
}

function carpetGroupDescription(label = '') {
  if (/salsa/i.test(label)) {
    return "Moquette Salsa à l'aspect velours, dotée d'une finition plus élégante et qualitative que la moquette standard. Idéale pour rehausser l'esthétique de votre stand.";
  }
  return 'Moquette premium avec une texture plus travaillée et une finition plus dense que la moquette standard.';
}

const adminTabStorageKey = 'standing-admin-active-tab';
const adminTabs = ['dashboard', 'salons', 'clients', 'bat', 'objects', 'presets', 'users', 'monday'];

function initialAdminTab() {
  try {
    const savedTab = window.localStorage.getItem(adminTabStorageKey);
    return adminTabs.includes(savedTab) ? savedTab : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

function rememberAdminTab(tab) {
  try {
    window.localStorage.setItem(adminTabStorageKey, tab);
  } catch {
    // Ignore private browsing / storage failures.
  }
}

function AdminDashboard({ user, adminProfile }) {
  const [scenes, setScenes] = useState([]);
  const [clients, setClients] = useState([]);
  const [salons, setSalons] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetCategory, setAssetCategory] = useState('Tout');
  const [filters, setFilters] = useState({ search: '', salon: '', status: '' });
  const [tab, setTabState] = useState(initialAdminTab);
  const [accountOpen, setAccountOpen] = useState(false);
  const [syncState, setSyncState] = useState({ loading: false, message: '', error: '' });
  const [assetUploadState, setAssetUploadState] = useState({ loading: false, message: '', error: '' });
  const profile = getAdminProfile(user, adminProfile);
  const setTab = (nextTab) => {
    rememberAdminTab(nextTab);
    setTabState(nextTab);
  };

  useEffect(() => {
    listScenes(filters).then(setScenes).catch((error) => console.error('Scene list failed', error));
    listClients(filters).then(setClients).catch((error) => console.error('Client list failed', error));
    listSalons({ search: filters.search }).then(setSalons).catch((error) => console.error('Salon list failed', error));
  }, [filters]);

  useEffect(() => {
    listObjectBank().then(setAssets).catch((error) => console.error('Object bank list failed', error));
  }, []);

  const refreshScenes = () => {
    return listScenes(filters).then(setScenes).catch((error) => console.error('Scene list failed', error));
  };

  const refreshClients = () => {
    return listClients(filters).then(setClients).catch((error) => console.error('Client list failed', error));
  };

  const refreshSalons = () => {
    return listSalons({ search: filters.search }).then(setSalons).catch((error) => console.error('Salon list failed', error));
  };

  const runMondaySync = async () => {
    setSyncState({ loading: true, message: '', error: '' });
    try {
      const result = await syncMondayScenes();
      await refreshScenes();
      await refreshClients();
      await refreshSalons();
      const createdCount = result?.created ?? result?.processed ?? 0;
      setSyncState({
        loading: false,
        message: createdCount
          ? `${createdCount} nouvelle(s) scène(s) créée(s), ${result?.clients ?? 0} exposant(s) traité(s) depuis Monday.`
          : 'Aucune nouvelle scène à créer depuis Monday.',
        error: '',
      });
    } catch (error) {
      setSyncState({
        loading: false,
        message: '',
        error: error.message || 'Synchronisation Monday impossible.',
      });
    }
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const saveAsset = async (asset) => {
    const saved = await saveObjectBankItem(asset);
    setAssets((current) => {
      const exists = current.some((item) => item.type === saved.type);
      if (exists) return current.map((item) => (item.type === saved.type ? { ...item, ...saved } : item));
      return [saved, ...current];
    });
    setSelectedAsset((current) => (current?.type === asset.type ? { ...current, ...saved } : current));
    return saved;
  };

  const deleteAsset = async (asset) => {
    if (!asset) return;
    const confirmed = window.confirm(`Supprimer définitivement "${asset.label}" de la banque d'objets ?`);
    if (!confirmed) return;
    await deleteObjectBankItem(asset);
    setAssets((current) => current.filter((item) => item.type !== asset.type));
    setSelectedAsset(null);
  };

  const uploadAssetFolder = async (files) => {
    if (!files?.length) return;
    setAssetUploadState({ loading: true, message: '', error: '' });
    try {
      const saved = await uploadObjectAssetFolder(files);
      setAssets((current) => [saved, ...current.filter((item) => item.type !== saved.type)]);
      setSelectedAsset(saved);
      setAssetCategory('Tout');
      setAssetUploadState({
        loading: false,
        message: `${saved.label} importe avec ${saved.dimensions?.uploadedFiles || 1} fichier(s).`,
        error: '',
      });
    } catch (error) {
      setAssetUploadState({
        loading: false,
        message: '',
        error: error.message || 'Import du dossier impossible.',
      });
    }
  };

  const uploadColorGroup = async (files) => {
    setAssetUploadState({ loading: true, message: '', error: '' });
    try {
      const saved = await uploadColorGroupFolder(files);
      setAssets((current) => [saved, ...current.filter((item) => item.type !== saved.type)]);
      setSelectedAsset(saved);
      setAssetCategory('Groupes de couleurs');
      setAssetUploadState({
        loading: false,
        message: `${saved.label} ajouté. Configure les usages, salons, prix et référence du groupe.`,
        error: '',
      });
    } catch (error) {
      setAssetUploadState({
        loading: false,
        message: '',
        error: error.message || 'Import du groupe de couleurs impossible.',
      });
    }
  };

  return (
    <main className="admin-dashboard-shell">
      <aside className="admin-sidebar">
        <a className="admin-sidebar-logo" href="/admin">
          <img src="/images/logo.png" alt="Stand-ING" />
        </a>
        <div className="admin-sidebar-product">Simulateur 3D - Stand'ING</div>
        <nav className="admin-sidebar-nav" aria-label="Navigation admin">
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><LayoutDashboard size={16} />Dashboard</button>
          <button className={tab === 'salons' ? 'active' : ''} onClick={() => setTab('salons')}><Orbit size={16} />Salons</button>
          <button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')}><Users size={16} />Exposants</button>
          <button className={tab === 'bat' ? 'active' : ''} onClick={() => setTab('bat')}><FileCheck2 size={16} />BAT</button>
          <button className={tab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}><Box size={16} />Assets 3D</button>
          <button className={tab === 'presets' ? 'active' : ''} onClick={() => setTab('presets')}><Settings2 size={16} />Packs</button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><UserPlus size={16} />Utilisateurs</button>
          <button className={tab === 'monday' ? 'active' : ''} onClick={() => setTab('monday')}><span className="monday-mark">m</span>Monday.com</button>
        </nav>
        <div className="admin-sidebar-user-wrap">
          <button className="admin-sidebar-user" type="button" onClick={() => setAccountOpen((open) => !open)}>
            <span>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.initials}</span>
            <div>
              <strong>{profile.name}</strong>
              <small>{profile.role}</small>
            </div>
            <ChevronUp size={14} />
          </button>
          {accountOpen && <AdminAccountPanel profile={profile} onLogout={() => supabase.auth.signOut().then(() => window.location.replace('/'))} />}
        </div>
      </aside>

      <section className="admin-main-panel">
        <header className="admin-topbar-new">
          <div>
            <h1>{adminTitle(tab)}</h1>
            <p>{adminSubtitle(tab)}</p>
          </div>
        </header>

        <div className="admin-page-content">
          {tab === 'dashboard' && <AdminDashboardHome scenes={scenes} assets={assets} />}
          {tab === 'salons' && (
            <AdminSalonsView
              salons={salons}
              onOpenSalon={(salon) => {
                updateFilter('salon', salon.name);
                setTab('clients');
              }}
            />
          )}
          {tab === 'presets' && (
            <AdminPresetsView
              salons={salons}
              assets={assets}
              onSalonChanged={refreshSalons}
            />
          )}
          {tab === 'clients' && <AdminClientsView clients={clients} filters={filters} updateFilter={updateFilter} />}
          {tab === 'objects' && (
            <AdminObjectsView
              assets={assets}
              scenes={scenes}
              search={filters.search}
              category={assetCategory}
              selectedAsset={selectedAsset}
              uploadState={assetUploadState}
              onCategoryChange={setAssetCategory}
              onSelectAsset={setSelectedAsset}
              onCloseAsset={() => setSelectedAsset(null)}
              onSaveAsset={saveAsset}
              onDeleteAsset={deleteAsset}
              onUploadAssetFolder={uploadAssetFolder}
              onUploadColorGroup={uploadColorGroup}
            />
          )}
          {tab === 'monday' && <AdminMondayView syncState={syncState} runMondaySync={runMondaySync} />}
          {tab === 'bat' && <AdminBatView scenes={scenes} assets={assets} />}
          {tab === 'users' && <AdminPlaceholder tab={tab} />}
        </div>
      </section>
    </main>
  );
}

function adminTitle(tab) {
  const labels = {
    dashboard: 'Dashboard',
    salons: 'Salons',
    clients: 'Exposants',
    bat: 'BAT',
    objects: 'Assets 3D',
    presets: 'Packs',
    users: 'Utilisateurs',
    monday: 'Monday.com',
  };
  return labels[tab] || 'Dashboard';
}

function adminSubtitle(tab) {
  if (tab === 'dashboard') return "Vue d'ensemble de l'activité Stand-ING";
  if (tab === 'salons') return 'Gestion des salons et de leurs configurations';
  if (tab === 'presets') return 'Gestion des packs disponibles par salon';
  if (tab === 'clients') return 'Exposants synchronisés et configurations associées';
  if (tab === 'monday') return 'Synchronisation des tableaux salon';
  return 'Vue en cours de préparation';
}

function getAdminProfile(user, adminProfile = {}) {
  const metadata = user?.user_metadata || {};
  const email = adminProfile?.email || user?.email || '';
  const name = adminProfile?.full_name || metadata.full_name || metadata.name || email || 'Administrateur';
  const avatarUrl = adminProfile?.avatar_url || metadata.avatar_url || metadata.picture || '';
  const initials = name
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'AD';

  return {
    name,
    email,
    role: adminProfile?.role_label || 'Admin',
    avatarUrl,
    initials,
    createdAt: adminProfile?.created_at,
  };
}

function AdminAccountPanel({ profile, onLogout }) {
  return (
    <div className="admin-account-panel">
      <div className="admin-account-head">
        <span>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.initials}</span>
        <div>
          <strong>{profile.name}</strong>
          <small>{profile.email}</small>
        </div>
      </div>
      <dl>
        <div><dt>Role</dt><dd>{profile.role}</dd></div>
        <div><dt>Compte créé</dt><dd>{formatDate(profile.createdAt)}</dd></div>
      </dl>
      <button type="button" onClick={onLogout}><LogOut size={14} /> Déconnexion</button>
    </div>
  );
}

function AdminDashboardHome({ scenes, assets }) {
  const stats = getAdminStats(scenes, assets);
  const batRows = getPendingBatRows(scenes);
  const recentItems = getRecentActivityRows(scenes, assets);
  const salonRows = getSalonRows(scenes);

  return (
    <>
      <section className="admin-kpi-grid">
        <AdminKpi icon={<Orbit size={22} />} value={stats.configs} label="Configs soumises" hint={`${stats.configuredThisMonth} ce mois`} color="blue" />
        <AdminKpi icon={<FileCheck2 size={22} />} value={stats.pendingBat} label="BAT en attente" hint={stats.pendingBat ? '— à valider' : 'aucun en attente'} color="orange" />
        <AdminKpi icon={<Check size={22} />} value={stats.signedBat} label="BAT signés" hint={`${stats.signedThisMonth} ce mois`} color="green" />
        <AdminKpi icon={<span>€</span>} value={`${stats.revenue.toLocaleString('fr-FR')} €`} label="CA estimé" hint={`${stats.averageArea.toFixed(0)} m² moyen`} color="navy" />
        <AdminKpi icon={<Globe2 size={22} />} value={stats.exhibitors} label="Exposants actifs" hint={`${assets.filter((asset) => asset.is_active).length} assets actifs`} color="purple" />
      </section>

      <section className="admin-section-block">
        <h2>▲ BAT en attente de validation</h2>
        <div className="admin-bat-card">
          {batRows.length ? batRows.map((row) => (
            <div className="admin-bat-row" key={row.id}>
              <span>{row.salon}</span>
              <span>{row.client}</span>
              <span>{row.stand}</span>
              <span className="warning">{row.status}</span>
              <span>{row.delay}</span>
            </div>
          )) : <div className="admin-empty-row">Aucun BAT en attente avec les données actuelles.</div>}
        </div>
      </section>

      <section className="admin-bottom-grid">
        <div className="admin-section-block">
          <h2>Activité récente</h2>
          <div className="admin-activity-card">
            {recentItems.length ? recentItems.map((item) => (
              <div className="admin-activity-row" key={item.id}>
                <span className={`activity-dot ${item.color}`} />
                <div><strong>{item.title}</strong><small>{item.subtitle}</small></div>
                <time>{item.time}</time>
              </div>
            )) : <div className="admin-empty-row">Aucune activité récente.</div>}
          </div>
        </div>
        <div className="admin-section-block">
          <h2>Salons actifs</h2>
          <div className="admin-salon-card">
            {salonRows.length ? salonRows.map((salon) => (
              <AdminSalonRow key={salon.title} title={salon.title} detail={salon.detail} status={salon.status} muted={!salon.active} />
            )) : <div className="admin-empty-row">Aucun salon synchronisé.</div>}
          </div>
        </div>
      </section>
    </>
  );
}

function getAdminStats(scenes, assets) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const configuredScenes = scenes.filter((scene) => ['draft', 'configured', 'bat_review', 'bat_validated'].includes(scene.client_status));
  const pendingBat = scenes.filter((scene) => scene.status === 'bat_pending' || scene.client_status === 'bat_review').length;
  const signedBat = scenes.filter((scene) => scene.status === 'validated' || scene.client_status === 'bat_validated').length;
  const exhibitors = new Set(scenes.map((scene) => scene.client_name).filter(Boolean)).size;
  const totalArea = scenes.reduce((sum, scene) => sum + Number(scene.dimensions?.width || scene.width_m || 0) * Number(scene.dimensions?.depth || scene.depth_m || 0), 0);

  return {
    configs: configuredScenes.length || scenes.length,
    pendingBat,
    signedBat,
    configuredThisMonth: scenes.filter((scene) => (scene.created_at || '').startsWith(thisMonth)).length,
    signedThisMonth: scenes.filter((scene) => (scene.updated_at || scene.created_at || '').startsWith(thisMonth) && (scene.status === 'validated' || scene.client_status === 'bat_validated')).length,
    revenue: Math.round(totalArea * 172.8),
    averageArea: scenes.length ? totalArea / scenes.length : 0,
    exhibitors,
    assets: assets.length,
  };
}

function getPendingBatRows(scenes) {
  return scenes
    .filter((scene) => scene.status === 'bat_pending' || scene.client_status === 'bat_review')
    .slice(0, 4)
    .map((scene) => ({
      id: scene.id,
      salon: normalizeSalonTitle(scene.event_name || scene.salon) || 'Salon à définir',
      client: scene.client_name || 'Exposant sans nom',
      stand: `${scene.project_name || 'Stand'} — ${sceneArea(scene)}m²`,
      status: scene.client_status === 'bat_review' ? 'En attente validation Stand-ING' : statusLabel(scene.status),
      delay: relativeDays(scene.updated_at || scene.created_at),
    }));
}

function getRecentActivityRows(scenes, assets) {
  const sceneRows = scenes.map((scene) => ({
    id: `scene-${scene.id}`,
    title: scene.client_status === 'configured' ? 'Config soumise' : clientStatusLabel(scene.client_status),
    subtitle: `${scene.client_name || 'Client'} — ${scene.salon || 'Salon'}`,
    time: relativeTime(scene.updated_at || scene.created_at),
    sortDate: new Date(scene.updated_at || scene.created_at || 0).getTime(),
    color: scene.client_status === 'configured' ? 'green' : 'blue',
  }));
  const assetRows = assets.slice(0, 2).map((asset) => ({
    id: `asset-${asset.type}`,
    title: 'Asset 3D disponible',
    subtitle: asset.label,
    time: relativeTime(asset.updated_at || asset.created_at),
    sortDate: new Date(asset.updated_at || asset.created_at || 0).getTime(),
    color: asset.is_active ? 'purple' : 'pale',
  }));
  return [...sceneRows, ...assetRows].sort((a, b) => b.sortDate - a.sortDate).slice(0, 5);
}

function normalizeSalonTitle(raw) {
  return (raw || '').replace(/\s*—\s*.+$/, '').trim();
}

function getSalonRows(scenes) {
  const grouped = scenes.reduce((acc, scene) => {
    const key = normalizeSalonTitle(scene.event_name || scene.salon) || 'Salon à définir';
    if (!acc.has(key)) acc.set(key, { title: key, count: 0, active: false });
    const current = acc.get(key);
    current.count += 1;
    current.active = current.active || scene.status !== 'archived';
    return acc;
  }, new Map());
  return [...grouped.values()].map((salon) => ({
    title: salon.title,
    detail: `${salon.count} exposant${salon.count > 1 ? 's' : ''}`,
    status: salon.active ? 'Actif' : 'À définir',
    active: salon.active,
  }));
}

function AdminKpi({ icon, value, label, hint, color }) {
  return (
    <article className="admin-kpi-card">
      <span className={`admin-kpi-icon ${color}`}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
        <em>{hint}</em>
      </div>
    </article>
  );
}

function AdminSalonRow({ title, detail, status, muted }) {
  return (
    <div className="admin-salon-row">
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
      <span className={muted ? 'muted' : ''}>{status}</span>
    </div>
  );
}

function AdminSalonsView({ salons, onOpenSalon }) {
  const [statusFilter, setStatusFilter] = useState('');
  const filteredSalons = salons.filter((salon) => !statusFilter || salon.status === statusFilter);

  return (
    <section className="admin-salons-view">
      <div className="admin-salons-toolbar">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Tous les salons</option>
          <option value="active">Actifs</option>
          <option value="upcoming">À venir</option>
          <option value="draft">À définir</option>
          <option value="archived">Archivés</option>
        </select>
      </div>

      <div className="admin-salon-card-grid">
        {filteredSalons.length ? filteredSalons.map((salon) => (
          <article className={`admin-salon-overview-card ${salonStatusKind(salon)}`} key={salon.id || salon.slug || salon.name}>
            <span className="salon-card-accent" />
            <div className="salon-card-body">
              <div className="salon-card-main">
                <header>
                  <h2>{salon.name}</h2>
                  <span className={`salon-status-pill ${salonStatusKind(salon)}`}>{salonStatusLabel(salon.status)}</span>
                </header>
                <p className="salon-meta-line">📅 {formatSalonDateRange(salon)}</p>
                <p className="salon-meta-line">📍 {salon.location || 'Lieu à définir'}</p>
                <p className="salon-offer-line">{salonOfferSummary(salon)}</p>
                <SalonPackStats salon={salon} />

                <div className="salon-card-metrics">
                  <div><strong>{salonExhibitorCount(salon) || '—'}</strong><span>Exposants</span></div>
                  <div><strong>{salonConfigCount(salon) || '—'}</strong><span>Configs</span></div>
                  <div><strong>{salonPendingBatCount(salon) || '—'}</strong><span>BAT en attente</span></div>
                </div>
              </div>

              <div className="salon-card-side">
                <button type="button" onClick={() => onOpenSalon?.(salon)}>Ouvrir</button>
                <SalonPreview salon={salon} />
              </div>
            </div>
          </article>
        )) : <div className="admin-empty-row">Aucun salon trouvé avec les filtres actuels.</div>}
      </div>
    </section>
  );
}

function SalonPackStats({ salon }) {
  const offers = salon.offers || [];
  if (!offers.length) return <div className="salon-pack-stats muted">Aucun pack associé.</div>;
  return (
    <div className="salon-pack-stats">
      {offers.map((offer) => {
        const sceneCount = (salon.scenes || []).filter((scene) => scene.offer_id === offer.id || normalizeTextValue(scene.offer) === normalizeTextValue(offer.name)).length;
        const itemCount = offer.presets?.[0]?.stand_preset_items?.length || 0;
        return (
          <div key={offer.id}>
            <span>{offer.name}</span>
            <strong>{sceneCount} config · {itemCount} inclus</strong>
          </div>
        );
      })}
    </div>
  );
}

function AdminPresetsView({ salons, assets, onSalonChanged }) {
  const [selectedSalonId, setSelectedSalonId] = useState(salons[0]?.id || '');
  const [editing, setEditing] = useState(null);
  const [basePackEditor, setBasePackEditor] = useState(null);
  const [boardEditor, setBoardEditor] = useState(null);
  const [actionState, setActionState] = useState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: '' });
  const selectedSalon = salons.find((salon) => salon.id === selectedSalonId) || salons[0] || null;

  useEffect(() => {
    if (!selectedSalonId && salons[0]?.id) setSelectedSalonId(salons[0].id);
    if (selectedSalonId && salons.length && !salons.some((salon) => salon.id === selectedSalonId)) {
      setSelectedSalonId(salons[0].id);
    }
  }, [salons, selectedSalonId]);

  const packCards = selectedSalon ? salonPackCards(selectedSalon) : [];

  const activatePack = async (entry) => {
    if (!selectedSalon) return;
    setActionState({ loadingPack: entry.packName, savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: '' });
    try {
      const { offer } = await ensureSalonOffer(selectedSalon, entry.packName);
      const nextSalon = mergeSalonOffer(selectedSalon, offer);
      setEditing({
        salon: nextSalon,
        salonShort: salonShortLabel(nextSalon.name),
        offer,
        preset: offer.presets?.[0] || null,
        packName: entry.packName,
        active: true,
      });
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: `${entry.packName} activé sur ${selectedSalon.name}.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || "Impossible d'activer ce pack." });
    }
  };

  const openPackEditor = async (entry) => {
    if (!selectedSalon) return;
    setActionState({ loadingPack: entry.packName, savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: '' });
    try {
      const { offer } = await ensureSalonOffer(selectedSalon, entry.packName);
      const nextSalon = mergeSalonOffer(selectedSalon, offer);
      setEditing({
        ...entry,
        salon: nextSalon,
        salonShort: salonShortLabel(nextSalon.name),
        offer,
        presets: offer.presets || [],
        preset: offer.presets?.find((item) => item.layout === 'u') || offer.presets?.[0] || null,
        active: true,
      });
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || "Impossible d'ouvrir ce pack." });
    }
  };

  const openBoardEditor = (entry) => {
    setBoardEditor({ packName: entry.packName, value: entry.source?.board_id || '' });
  };

  const openBasePackEditor = async (entry) => {
    if (!selectedSalon) return;
    setActionState({ loadingPack: entry.packName, savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: '' });
    try {
      const { offer } = await ensureSalonOffer(selectedSalon, entry.packName);
      const nextSalon = mergeSalonOffer(selectedSalon, offer);
      setBasePackEditor({ ...entry, salon: nextSalon, offer, active: true });
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || "Impossible d'ouvrir le pack de base." });
    }
  };

  const saveBasePack = async (offer, baseItems) => {
    setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: offer?.name || '', deletingPresetId: '', message: '', error: '' });
    try {
      const savedOffer = await saveSalonOfferBaseItems(offer, baseItems);
      setBasePackEditor(null);
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: `Pack de base ${savedOffer.name} sauvegardé.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible de sauvegarder le pack de base.' });
    }
  };

  const saveBoardId = async (event, entry) => {
    event.preventDefault();
    if (!selectedSalon || !boardEditor) return;
    setActionState({ loadingPack: '', savingBoardPack: entry.packName, savingBasePack: '', deletingPresetId: '', message: '', error: '' });
    try {
      await saveMondayBoardForPack(selectedSalon, entry.packName, boardEditor.value);
      setBoardEditor(null);
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: `Board Monday enregistré pour ${entry.packName}.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || "Impossible d'enregistrer le board Monday." });
    }
  };

  const removePreset = async (entry) => {
    if (!entry.preset) return;
    const confirmed = window.confirm(`Retirer le pack ${entry.packName} de ${selectedSalon?.name || 'ce salon'} ? Le board Monday restera configuré.`);
    if (!confirmed) return;

    setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: entry.preset.id, message: '', error: '' });
    try {
      await deleteStandPreset(entry.preset);
      setEditing((current) => (current?.preset?.id === entry.preset.id ? null : current));
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: `Pack ${entry.packName} retiré pour ce salon.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible de retirer ce pack.' });
    }
  };

  return (
    <section className="admin-presets-view">
      <header className="presets-toolbar">
        <div className="preset-salon-tabs">
          <span>Salon :</span>
          {salons.map((salon) => (
            <button key={salon.id} type="button" className={salon.id === selectedSalon?.id ? 'active' : ''} onClick={() => setSelectedSalonId(salon.id)}>
              {salon.name}
            </button>
          ))}
        </div>
      </header>

      {actionState.message && <div className="preset-library-feedback success">{actionState.message}</div>}
      {actionState.error && <div className="preset-library-feedback error">{actionState.error}</div>}

      <div className="preset-library-grid">
        {packCards.length ? packCards.map((entry) => (
          <article className={`preset-library-card ${entry.active ? '' : 'inactive'}`} key={`${selectedSalon?.id || 'salon'}-${entry.packName}`}>
            <button className="preset-card-menu" type="button" aria-label="Options pack">⋮</button>
            <div className="preset-card-preview">{entry.active ? presetReferenceLabel(entry.preset, entry.presets) : '—'}</div>
            <div className="preset-card-body">
              <strong>{entry.salonShort} - {entry.packName}</strong>
              <span>{entry.active ? presetMetaLabel(entry.preset, entry.presets) : 'Pack non activé sur ce salon'}</span>
              <small className="preset-board-line">
                Monday : {entry.source?.board_id ? `board ${entry.source.board_id}` : 'aucun board'}
              </small>
              <div>
                {entry.active ? (
                  <>
                    <button className="primary" type="button" disabled={actionState.loadingPack === entry.packName} onClick={() => openPackEditor(entry)}>
                      {actionState.loadingPack === entry.packName ? 'Ouverture...' : 'Modifier'}
                    </button>
                    <button type="button" onClick={() => openBoardEditor(entry)}>
                      {entry.source?.board_id ? 'Modifier board' : 'Ajouter board ID'}
                    </button>
                    <button type="button" disabled={actionState.savingBasePack === entry.packName} onClick={() => openBasePackEditor(entry)}>
                      Pack de base
                    </button>
                    <button className="danger" type="button" disabled={actionState.deletingPresetId === entry.preset?.id} onClick={() => removePreset(entry)}>
                      {actionState.deletingPresetId === entry.preset?.id ? 'Suppression...' : 'Retirer pack'}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="activate-pack" type="button" disabled={actionState.loadingPack === entry.packName} onClick={() => activatePack(entry)}>
                      {actionState.loadingPack === entry.packName ? 'Activation...' : 'Activer ce pack sur ce salon'}
                    </button>
                    <button type="button" onClick={() => openBoardEditor(entry)}>
                      {entry.source?.board_id ? 'Modifier board' : 'Ajouter board ID'}
                    </button>
                    <button type="button" disabled={actionState.loadingPack === entry.packName} onClick={() => openBasePackEditor(entry)}>
                      Pack de base
                    </button>
                  </>
                )}
              </div>
              {boardEditor?.packName === entry.packName && (
                <form className="preset-board-editor" onSubmit={(event) => saveBoardId(event, entry)}>
                  <input
                    autoFocus
                    value={boardEditor.value}
                    inputMode="numeric"
                    placeholder="Ex : 18395911999"
                    onChange={(event) => setBoardEditor((current) => ({ ...current, value: event.target.value }))}
                  />
                  <button type="submit" disabled={actionState.savingBoardPack === entry.packName}>
                    {actionState.savingBoardPack === entry.packName ? '...' : 'OK'}
                  </button>
                  <button type="button" onClick={() => setBoardEditor(null)}>Annuler</button>
                </form>
              )}
            </div>
            <i />
          </article>
        )) : (
          <div className="admin-empty-row">Aucun salon disponible pour les packs.</div>
        )}
      </div>

      {editing && (
        <AdminSalonPresetConfigurator
          salon={editing.salon}
          assets={assets}
          initialOfferId={editing.offer?.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await onSalonChanged?.();
          }}
        />
      )}

      {basePackEditor && (
        <BasePackEditorModal
          salon={basePackEditor.salon || selectedSalon}
          offer={basePackEditor.offer}
          assets={assets}
          saving={actionState.savingBasePack === basePackEditor.offer?.name}
          onClose={() => setBasePackEditor(null)}
          onSave={(baseItems) => saveBasePack(basePackEditor.offer, baseItems)}
        />
      )}
    </section>
  );
}

function salonPackCards(salon) {
  return defaultPackNames.map((packName) => {
    const offer = (salon.offers || []).find((item) => normalizeTextValue(item.name) === normalizeTextValue(packName)) || null;
    const presets = offer?.presets?.length ? offer.presets : (salon.presets || []).filter((item) => item.offer_id === offer?.id);
    const preset = presets.find((item) => item.layout === 'u') || presets[0] || null;
    const source = offer?.monday_source || (salon.monday_sources || []).find((item) => normalizeTextValue(item.offer) === normalizeTextValue(packName)) || null;
    return {
      salon,
      salonShort: salonShortLabel(salon.name),
      offer,
      presets,
      preset,
      source,
      packName,
      active: Boolean(offer && presets.length),
    };
  });
}

function mergeSalonOffer(salon, offer) {
  return {
    ...salon,
    offers: [...(salon.offers || []).filter((item) => item.id !== offer.id), offer],
    presets: [...(salon.presets || []).filter((item) => item.offer_id !== offer.id), ...(offer.presets || [])],
    monday_sources: offer.monday_source
      ? [...(salon.monday_sources || []).filter((item) => item.id !== offer.monday_source.id), offer.monday_source]
      : (salon.monday_sources || []),
  };
}

function BasePackEditorModal({ salon, offer, assets, saving, onClose, onSave }) {
  const entries = useMemo(() => {
    const dynamicEntries = (assets || [])
      .filter((asset) => asset.is_active)
      .filter((asset) => !asset.dimensions?.isColorGroup)
      .filter((asset) => assetMatchesSalon(asset, salon?.name))
      .map((asset) => assetToCatalogEntry(asset, assets))
      .filter(Boolean);
    const all = [...dynamicEntries, ...nativeCatalogEntries()];
    return uniqueCatalogEntries(all).filter((entry) => isBasePackEligible(entry));
  }, [assets, salon?.name]);
  const [quantities, setQuantities] = useState(() => baseItemsToQuantityMap(offer?.metadata?.baseItems));

  useEffect(() => {
    setQuantities(baseItemsToQuantityMap(offer?.metadata?.baseItems));
  }, [offer?.id, offer?.metadata?.baseItems]);

  const updateQuantity = (type, nextQuantity) => {
    setQuantities((current) => ({
      ...current,
      [type]: Math.max(0, Number(nextQuantity || 0)),
    }));
  };

  const save = () => {
    const baseItems = entries
      .map((entry) => ({
        type: entry.type,
        label: entry.label,
        quantity: Number(quantities[entry.type] || 0),
      }))
      .filter((item) => item.quantity > 0);
    onSave(baseItems);
  };

  return (
    <div className="asset-drawer-layer">
      <aside className="asset-drawer base-pack-drawer">
        <header>
          <div>
            <h2>Pack de base</h2>
            <span>{salon?.name} · {offer?.name}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </header>

        <div className="base-pack-help">
          Ces quantités sont incluses dans la formule, sans poser les objets sur la scène.
          Elles sont communes à toutes les implantations du pack.
        </div>

        <div className="base-pack-list">
          {entries.map((entry) => {
            const Icon = entry.icon || Box;
            const quantity = Number(quantities[entry.type] || 0);
            return (
              <article key={entry.type} className={quantity > 0 ? 'active' : ''}>
                <span>{entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <Icon size={22} />}</span>
                <div>
                  <strong>{entry.label}</strong>
                  <small>{formatFurniturePrice(entry, salon?.name)} · {assetReference(entry, salon?.name) || 'Sans référence'}</small>
                </div>
                <div className="quantity-control">
                  <button type="button" onClick={() => updateQuantity(entry.type, quantity - 1)} disabled={quantity <= 0}>−</button>
                  <input
                    value={quantity}
                    inputMode="numeric"
                    onChange={(event) => updateQuantity(entry.type, event.target.value)}
                  />
                  <button type="button" onClick={() => updateQuantity(entry.type, quantity + 1)}>+</button>
                </div>
              </article>
            );
          })}
        </div>

        <footer>
          <button type="button" className="asset-delete" onClick={onClose}>Annuler</button>
          <button type="button" className="asset-save" disabled={saving} onClick={save}>
            {saving ? 'Sauvegarde...' : 'Sauvegarder le pack de base'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function AdminSalonPresetConfigurator({ salon, assets, initialOfferId = '', onClose, onSaved }) {
  const initialOffer = (salon.offers || []).find((offer) => offer.id === initialOfferId) || salon.offers?.[0] || null;
  const [localSalon, setLocalSalon] = useState(salon);
  const [saveState, setSaveState] = useState({ loading: false, message: '', error: '' });
  const [selectedLayout, setSelectedLayout] = useState('u');
  const selectedOffer = (localSalon.offers || []).find((offer) => offer.id === initialOfferId) || initialOffer || null;
  const offerPresets = selectedOffer?.presets?.length ? selectedOffer.presets : (localSalon.presets || []).filter((preset) => preset.offer_id === selectedOffer?.id);
  const activePreset = offerPresets.find((preset) => (preset.layout || 'u') === selectedLayout) || offerPresets[0] || null;

  useEffect(() => {
    setLocalSalon(salon);
    const nextOffer = (salon.offers || []).find((offer) => offer.id === initialOfferId) || salon.offers?.[0] || null;
    const nextPresets = nextOffer?.presets?.length ? nextOffer.presets : (salon.presets || []).filter((preset) => preset.offer_id === nextOffer?.id);
    setSelectedLayout(nextPresets.find((preset) => preset.layout === 'u')?.layout || nextPresets[0]?.layout || 'u');
  }, [salon, initialOfferId]);

  const savePreset = async (sceneDraft) => {
    if (!activePreset) return;
    setSaveState({ loading: true, message: '', error: '' });
    try {
      const savedPreset = await saveStandPresetConfig(activePreset, sceneDraft);
      setLocalSalon((current) => ({
        ...current,
        presets: [...(current.presets || []).filter((item) => item.id !== savedPreset.id), savedPreset],
        offers: (current.offers || []).map((offer) => (
          offer.id === selectedOffer?.id
            ? { ...offer, presets: [...(offer.presets || []).filter((item) => item.id !== savedPreset.id), savedPreset] }
            : offer
        )),
      }));
      setSaveState({ loading: false, message: `Base ${layoutLabel(savedPreset.layout)} sauvegardée. Monday appliquera cette référence pour la même implantation.`, error: '' });
      await onSaved?.();
    } catch (error) {
      setSaveState({ loading: false, message: '', error: error.message || 'Sauvegarde impossible.' });
    }
  };

  return (
    <div className="salon-preset-layer">
      <section className="salon-preset-modal">
        <header className="salon-preset-header">
          <div>
            <span>Configuration de base</span>
            <h2>{localSalon.name}{selectedOffer ? ` · ${selectedOffer.name}` : ''}</h2>
            <p>Les objets placés ici composent la scène de départ selon l'implantation. Les quotas gratuits se règlent dans “Pack de base”.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </header>

        <div className="preset-save-feedback-slot">
          {saveState.message && <div className="preset-save-feedback success">{saveState.message}</div>}
          {saveState.error && <div className="preset-save-feedback error">{saveState.error}</div>}
        </div>

        {activePreset ? (
          <div className="preset-modal-body">
            <div className="preset-layout-reference-tabs">
              <span>Base à configurer :</span>
              {layouts.map((layoutOption) => {
                const layoutPreset = offerPresets.find((preset) => (preset.layout || 'u') === layoutOption.id);
                const itemCount = layoutPreset?.stand_preset_items?.length || 0;
                return (
                  <button key={layoutOption.id} type="button" className={selectedLayout === layoutOption.id ? 'active' : ''} onClick={() => setSelectedLayout(layoutOption.id)}>
                    {layoutOption.label}
                    <small>{itemCount} objet{itemCount > 1 ? 's' : ''}</small>
                  </button>
                );
              })}
            </div>
            <PresetSceneEditor
              key={activePreset.id}
              salon={localSalon}
              offer={selectedOffer}
              preset={activePreset}
              assets={assets}
              saving={saveState.loading}
              onSave={savePreset}
              onPresetLayoutChange={setSelectedLayout}
            />
          </div>
        ) : (
          <div className="admin-empty-row">Sélectionne ou ajoute un pack pour configurer sa scène de base.</div>
        )}
      </section>
    </div>
  );
}

function PresetSceneEditor({ salon, offer, preset, assets, saving, onSave, onPresetLayoutChange }) {
  const availableCatalog = useMemo(() => {
    const dynamicEntries = (assets || [])
      .filter((asset) => asset.is_active)
      .filter((asset) => !asset.dimensions?.isColorGroup)
      .filter((asset) => assetMatchesSalon(asset, salon.name))
      .map((asset) => assetToCatalogEntry(asset, assets))
      .filter(Boolean);
    const entries = [...dynamicEntries, ...nativeCatalogEntries()];
    return uniqueCatalogEntries(entries);
  }, [assets, salon.name]);
  const initialScene = useMemo(() => presetToEditableScene(preset, availableCatalog), [preset, availableCatalog]);
  const initialWidth = initialScene.dimensions.width;
  const initialDepth = initialScene.dimensions.depth;
  const initialLayout = initialScene.layout;
  const [width, setWidth] = useState(initialWidth);
  const [depth, setDepth] = useState(initialDepth);
  const height = fixedWallHeight;
  const [layout, setLayout] = useState(initialLayout);
  const [items, setItems] = useState(() => initialScene.items.map((item) => constrainItem(item, initialWidth, initialDepth, initialLayout)));
  const [selectedId, setSelectedId] = useState(initialScene.items[0]?.id || null);
  const [draggingId, setDraggingId] = useState(null);
  const [orbitControlsActive, setOrbitControlsActive] = useState(false);
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const [reserveRules, setReserveRules] = useState(() => normalizeReserveRules(preset.base_config?.reserveRules || preset.base_config?.options?.reserveRules, { keepEmptyOptions: true }));
  const [partitionHeadRules, setPartitionHeadRules] = useState(() => normalizePartitionHeadRules(preset.base_config?.partitionHeadRules || preset.base_config?.options?.partitionHeadRules));
  const [autoSpotsRule, setAutoSpotsRule] = useState(() => preset.base_config?.autoSpotsRule || null);
  const [presetColorIds, setPresetColorIds] = useState(() => presetDefaultColorIds(preset));
  const carpetPalette = useMemo(() => colorOptionsForUsage(assets, salon.name, 'carpet', carpetColors), [assets, salon.name]);
  const footprintPalette = useMemo(() => colorOptionsForUsage(assets, salon.name, 'footprint', carpetPalette), [assets, salon.name, carpetPalette]);
  const wallFabricPalette = useMemo(() => colorOptionsForUsage(assets, salon.name, 'wallFabric', wallFabricColors), [assets, salon.name]);
  const selectedCarpetColor = findColorInPalette(carpetPalette, presetColorIds.carpetColorId) || defaultColorFromPalette(carpetPalette) || carpetPalette[0] || carpetColors[0];
  const selectedCarpetFootprintColor = findColorInPalette(footprintPalette, presetColorIds.carpetFootprintColorId) || defaultColorFromPalette(footprintPalette) || selectedCarpetColor;
  const selectedWallFabricColor = findColorInPalette(wallFabricPalette, presetColorIds.wallFabricColorId) || defaultColorFromPalette(wallFabricPalette) || wallFabricPalette[0] || wallFabricColors[0];
  const selectedReserveWallFabricColor = findColorInPalette(wallFabricPalette, presetColorIds.reserveWallFabricColorId) || selectedWallFabricColor;
  const selectedDefaultColorOptions = useMemo(() => defaultColorOptionsFromColors({
    carpetColor: selectedCarpetColor,
    carpetFootprintColor: selectedCarpetFootprintColor,
    wallFabricColor: selectedWallFabricColor,
    reserveWallFabricColor: selectedReserveWallFabricColor,
  }), [selectedCarpetColor, selectedCarpetFootprintColor, selectedWallFabricColor, selectedReserveWallFabricColor]);
  const presetTextureLoad = useSceneTexturePreload(items, [
    selectedCarpetColor.image,
    selectedCarpetFootprintColor.image,
    selectedWallFabricColor.image,
    selectedReserveWallFabricColor.image,
  ]);
  const presetSuspendLoad = useSceneSuspendPreload(items);
  const presetAssetsReady = presetTextureLoad.ready && presetSuspendLoad.ready;
  const presetLoadProgress = combineLoadStates(presetTextureLoad, presetSuspendLoad);
  const selected = items.find((item) => item.id === selectedId);

  useEffect(() => {
    setItems((current) => current.map((item) => constrainItem(hydrateSceneItemFromCatalog(item, availableCatalog), width, depth, layout)));
  }, [width, depth, layout, availableCatalog]);

  useEffect(() => {
    setReserveRules(normalizeReserveRules(preset.base_config?.reserveRules || preset.base_config?.options?.reserveRules, { keepEmptyOptions: true }));
    setPartitionHeadRules(normalizePartitionHeadRules(preset.base_config?.partitionHeadRules || preset.base_config?.options?.partitionHeadRules));
    setAutoSpotsRule(preset.base_config?.autoSpotsRule || null);
    setPresetColorIds(presetDefaultColorIds(preset));
  }, [preset.id, preset.base_config]);

  const updateItem = (id, patch) => {
    setItems((current) => updateSceneItemWithCollision(current, id, patch, width, depth, layout));
  };

  const moveDraggedItem = (point) => {
    if (!draggingId) return;
    const dragged = items.find((item) => item.id === draggingId);
    if (!dragged) return;
    if (isWallItem(dragged)) {
      updateItem(draggingId, wallDragPatch(point, dragged, items, width, depth, layout));
      return;
    }
    updateItem(draggingId, { x: point.x, z: point.z });
  };

  const addItem = (entry) => {
    const item = makeItem(entry.type, width, depth, layout, entry);
    setItems((current) => {
      const placed = placeItemInFreeSpot({ ...item, label: entry.label }, current, width, depth, layout);
      if (!placed) return current;
      return [...current, placed];
    });
    setSelectedId(item.id);
  };

  const chooseLayout = (nextLayout) => {
    if (onPresetLayoutChange && nextLayout !== layout) {
      onPresetLayoutChange(nextLayout);
      return;
    }
    setLayout(nextLayout);
    setItems((current) => current.map((item) => constrainItem(item, width, depth, nextLayout)));
  };

  const save = () => {
    const cleanedReserveRules = normalizeReserveRules(reserveRules);
    onSave({
      dimensions: { width, depth, height: fixedWallHeight },
      layout,
      items,
      reserveRules: cleanedReserveRules,
      partitionHeadRules,
      autoSpotsRule: autoSpotsRule || undefined,
      defaultColorOptions: selectedDefaultColorOptions,
      options: {
        presetMode: true,
        includedPack: offer?.name,
        salon: salon.name,
        reserveRules: cleanedReserveRules,
        partitionHeadRules,
        autoSpotsRule: autoSpotsRule || undefined,
        defaultColorOptions: selectedDefaultColorOptions,
        ...selectedDefaultColorOptions,
      },
    });
  };

  return (
    <div className="preset-editor-grid">
      <section className="preset-3d-stage">
        <Canvas
          camera={{ position: [4.5, 4.2, 5.7], fov: 48 }}
          dpr={[1, 1.5]}
          className={!presetAssetsReady ? 'scene-canvas-loading' : ''}
          shadows
          onPointerUp={() => setDraggingId(null)}
          onPointerLeave={() => setDraggingId(null)}
        >
          <color attach="background" args={['#eef0f4']} />
          <ambientLight intensity={1.05} />
          <directionalLight position={[3, 7, 4]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center>Chargement</Html>}>
            {presetAssetsReady && (
            <StandScene
              width={width}
              depth={depth}
              height={height}
              layout={layout}
              items={items}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              hoverEnabled={!orbitControlsActive}
              canEditLockedItems
              onDragMove={moveDraggedItem}
              viewAngle={35}
              carpetColor={selectedCarpetColor}
              carpetFootprintColor={selectedCarpetFootprintColor}
              wallFabricColor={selectedWallFabricColor}
              reserveWallFabricColor={selectedReserveWallFabricColor}
            />
            )}
            <ContactShadows opacity={0.12} scale={12} blur={2.8} far={5} position={[0, -0.01, 0]} />
          </Suspense>
          <OrbitControls makeDefault target={[0, 0.7, 0]} minPolarAngle={Math.PI / 5.2} maxPolarAngle={Math.PI / 2.25} minDistance={4} maxDistance={11} enablePan enabled={!draggingId} onStart={() => setOrbitControlsActive(true)} onEnd={() => setOrbitControlsActive(false)} />
        </Canvas>

        {!presetAssetsReady && <SceneTextureLoaderOverlay loaded={presetLoadProgress.loaded} total={presetLoadProgress.total} />}

        {selected && (
          <div className="view-toolbar preset-toolbar selection-mode">
            <button type="button" disabled={itemPlacementLocked(selected)} onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
            <button type="button" onClick={() => { setItems((current) => current.filter((item) => item.id !== selected.id)); setSelectedId(null); }} title="Supprimer"><Trash2 size={16} /></button>
            {itemPlacementLocked(selected) && <span className="toolbar-lock-note">Placement verrouillé</span>}
            {rotationPanelOpen && !isWallItem(selected) && !itemPlacementLocked(selected) && (
              <label className="toolbar-rotation-slider">
                <span>{selected.rotation || 0}°</span>
                <input type="range" min="-180" max="180" step="5" value={selected.rotation || 0} onChange={(event) => updateItem(selected.id, { rotation: Number(event.target.value) })} />
              </label>
            )}
          </div>
        )}
      </section>

      <aside className="preset-side-panel">
        <h3>{offer?.name || 'Pack'} · {salon.name}</h3>
        <p>Cette base est spécifique à l'implantation {layoutLabel(layout)}. Change d'onglet pour configurer les autres murs.</p>
        <div className="preset-dimensions">
          <label>Largeur <span>{width} m</span><input type="range" min="2" max="12" step="0.5" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
          <label>Profondeur <span>{depth} m</span><input type="range" min="2" max="10" step="0.5" value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label>
        </div>
        <div className="preset-layouts">
          {layouts.map((option) => (
            <button key={option.id} className={layout === option.id ? 'active' : ''} type="button" onClick={() => chooseLayout(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        <PresetDefaultColorsEditor
          carpetColors={carpetPalette}
          footprintColors={footprintPalette}
          wallFabricColors={wallFabricPalette}
          selectedIds={presetColorIds}
          onChange={setPresetColorIds}
        />
        <PresetReserveRulesEditor
          rules={reserveRules}
          entries={availableCatalog.filter(isReserveCatalogEntry)}
          salonLabel={salon.name}
          onChange={setReserveRules}
        />
        <PresetPartitionHeadRulesEditor
          rules={partitionHeadRules}
          entries={availableCatalog.filter(isPartitionHeadItem)}
          salonLabel={salon.name}
          onChange={setPartitionHeadRules}
        />
        <PresetAutoSpotsEditor
          rule={autoSpotsRule}
          entries={availableCatalog.filter((e) => !e.isGroup && !isVariantGroupEntry(e))}
          width={width}
          depth={depth}
          onChange={setAutoSpotsRule}
        />
        <h4>Objets inclus</h4>
        <p className="preset-included-help">Chaque objet sauvegardé ici est inclus dans la formule. Le client ne paiera que les quantités ajoutées au-delà.</p>
        <div className="preset-catalog">
          {availableCatalog.filter((entry) => !isVariantGroupEntry(entry)).map((entry) => {
            const Icon = entry.icon;
            return (
              <button key={entry.type} type="button" onClick={() => addItem(entry)}>
                <Icon size={16} />
                <span>{entry.label}</span>
                <Plus size={13} />
              </button>
            );
          })}
        </div>
        <button className="preset-save-button" type="button" disabled={saving} onClick={save}>
          {saving ? 'Sauvegarde...' : 'Sauvegarder ce pack'}
        </button>
      </aside>
    </div>
  );
}

function PresetDefaultColorsEditor({ carpetColors = [], footprintColors = [], wallFabricColors = [], selectedIds = {}, onChange }) {
  const update = (key, value) => onChange((current) => ({ ...(current || {}), [key]: value }));
  return (
    <section className="preset-default-colors">
      <header>
        <strong>Couleurs de base</strong>
        <span>Ces couleurs seront appliquées d'office aux scènes générées depuis cette implantation.</span>
      </header>
      <PresetColorSelect
        label="Sol / moquette"
        colors={carpetColors}
        value={selectedIds.carpetColorId}
        onChange={(value) => update('carpetColorId', value)}
      />
      <PresetColorSelect
        label="Empreinte moquette"
        colors={footprintColors}
        value={selectedIds.carpetFootprintColorId}
        fallbackValue={selectedIds.carpetColorId}
        onChange={(value) => update('carpetFootprintColorId', value)}
      />
      <PresetColorSelect
        label="Murs / coton cloison"
        colors={wallFabricColors}
        value={selectedIds.wallFabricColorId}
        onChange={(value) => update('wallFabricColorId', value)}
      />
      <PresetColorSelect
        label="Cloisons de la réserve"
        colors={wallFabricColors}
        value={selectedIds.reserveWallFabricColorId}
        fallbackValue={selectedIds.wallFabricColorId}
        onChange={(value) => update('reserveWallFabricColorId', value)}
      />
    </section>
  );
}

function PresetColorSelect({ label, colors = [], value = '', fallbackValue = '', onChange }) {
  const selectedValue = value || fallbackValue || defaultColorFromPalette(colors)?.id || colors[0]?.id || '';
  return (
    <label className="preset-color-select">
      <span>{label}</span>
      <select value={selectedValue} onChange={(event) => onChange(event.target.value)}>
        {colors.map((color) => (
          <option key={color.id} value={color.id}>
            {color.name || color.code || color.id}{color.code ? ` (${color.code})` : ''}
          </option>
        ))}
      </select>
      <i style={{ '--swatch-color': colorHex(findColorInPalette(colors, selectedValue), '#d9dde5'), '--swatch-image': `url("${colorTextureUrl(findColorInPalette(colors, selectedValue))}")` }} />
    </label>
  );
}

function presetDefaultColorIds(preset = {}) {
  const defaults = preset?.base_config?.defaultColorOptions || preset?.base_config?.options?.defaultColorOptions || {};
  return {
    carpetColorId: defaults.carpetColorId || preset?.base_config?.options?.carpetColorId || '',
    carpetFootprintColorId: defaults.carpetFootprintColorId || preset?.base_config?.options?.carpetFootprintColorId || '',
    wallFabricColorId: defaults.wallFabricColorId || preset?.base_config?.options?.wallFabricColorId || '',
    reserveWallFabricColorId: defaults.reserveWallFabricColorId || preset?.base_config?.options?.reserveWallFabricColorId || '',
  };
}

function PresetReserveRulesEditor({ rules, entries, salonLabel, onChange }) {
  const updateBand = (bandId, patch) => {
    onChange(normalizeReserveRules({
      ...(rules || {}),
      [bandId]: {
        ...(rules?.[bandId] || {}),
        ...patch,
      },
    }, { keepEmptyOptions: true }));
  };
  const updateOption = (bandId, index, patch) => {
    const currentOptions = normalizeComplementaryOptions(rules?.[bandId]?.options, { keepEmpty: true });
    const nextOptions = currentOptions.map((option, optionIndex) => (optionIndex === index ? { ...option, ...patch } : option));
    updateBand(bandId, { options: nextOptions });
  };
  const addOption = (bandId) => updateBand(bandId, { options: [...normalizeComplementaryOptions(rules?.[bandId]?.options, { keepEmpty: true }), { type: '', label: '', price: '' }] });
  const removeOption = (bandId, index) => updateBand(bandId, { options: normalizeComplementaryOptions(rules?.[bandId]?.options, { keepEmpty: true }).filter((_, optionIndex) => optionIndex !== index) });

  return (
    <section className="preset-reserve-rules">
      <h4>Réserves automatiques</h4>
      <p>Ces règles sont propres à cette implantation. Les options complémentaires remplacent la réserve incluse et facturent le supplément indiqué.</p>
      {!entries.length && <div className="preset-reserve-empty">Aucun groupe/objet réserve disponible pour ce salon.</div>}
      {reserveRuleBands.map((band) => {
        const rule = rules?.[band.id] || {};
        return (
          <article key={band.id}>
            <strong>{band.label}</strong>
            <label>
              Réserve incluse
              <select value={rule.includedType || ''} onChange={(event) => {
                const entry = entries.find((item) => item.type === event.target.value);
                updateBand(band.id, { includedType: event.target.value, includedLabel: entry?.label || band.includedLabel });
              }}>
                <option value="">Aucune</option>
                {entries.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
              </select>
            </label>
            <div className="preset-rule-options">
              <span>Options complémentaires</span>
              {normalizeComplementaryOptions(rule.options, { keepEmpty: true }).map((option, index) => {
                const entry = findCatalogEntry(entries, option.type);
                return (
                  <div className="preset-rule-option-row" key={`${band.id}-${index}`}>
                    <select value={option.type || ''} onChange={(event) => {
                      const nextEntry = entries.find((item) => item.type === event.target.value);
                      updateOption(band.id, index, { type: event.target.value, label: nextEntry?.label || '' });
                    }}>
                      <option value="">Objet</option>
                      {entries.map((entryOption) => <option key={entryOption.type} value={entryOption.type}>{entryOption.label}</option>)}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={option.price ?? ''}
                      placeholder={String(reserveOptionPrice(option, entry, salonLabel) || 0)}
                      onChange={(event) => updateOption(band.id, index, { price: event.target.value })}
                    />
                    <button type="button" onClick={() => removeOption(band.id, index)}><Trash2 size={13} /></button>
                  </div>
                );
              })}
              <button type="button" className="preset-add-rule-option" onClick={() => addOption(band.id)}>
                <Plus size={13} /> Ajouter une option
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function PresetPartitionHeadRulesEditor({ rules, entries, salonLabel, onChange }) {
  const updateBand = (bandId, patch) => {
    onChange(normalizePartitionHeadRules({
      ...(rules || {}),
      [bandId]: {
        ...(rules?.[bandId] || {}),
        ...patch,
      },
    }));
  };

  return (
    <section className="preset-reserve-rules">
      <h4>Têtes de cloison automatiques</h4>
      <p>Le nombre inclus dépend de la surface. Dans l'étape 2, l'exposant coche gauche/droite ; tout dépassement devient payant.</p>
      {!entries.length && <div className="preset-reserve-empty">Aucune tête de cloison disponible pour ce salon.</div>}
      {partitionHeadRuleBands.map((band) => {
        const rule = rules?.[band.id] || {};
        const includedCount = Number(rule.includedCount ?? band.includedCount ?? 0);
        const includedSideValue = includedCount >= 2 ? 'both' : includedCount <= 0 ? 'none' : (rule.includedSides?.[0] || '');
        return (
          <article key={band.id}>
            <strong>{band.label} · {includedCount} incluse{includedCount > 1 ? 's' : ''}</strong>
            {includedCount === 1 && (
              <label>
                Placée d'office à la génération
                <select value={includedSideValue} onChange={(event) => updateBand(band.id, { includedSides: event.target.value ? [event.target.value] : [] })}>
                  <option value="">À choisir</option>
                  <option value="left">Tête gauche</option>
                  <option value="right">Tête droite</option>
                </select>
              </label>
            )}
            {includedCount >= 2 && <div className="preset-reserve-empty">Gauche + droite incluses et placées d'office.</div>}
            {includedCount <= 0 && <div className="preset-reserve-empty">Aucune tête placée d'office, les coches seront payantes.</div>}
            {['left', 'right'].map((side) => {
              const sideLabel = side === 'left' ? 'Gauche' : 'Droite';
              const typeKey = side === 'left' ? 'leftType' : 'rightType';
              const labelKey = side === 'left' ? 'leftLabel' : 'rightLabel';
              const priceKey = side === 'left' ? 'leftPrice' : 'rightPrice';
              const entry = findCatalogEntry(entries, rule[typeKey]);
              return (
                <div className="preset-head-rule-row" key={`${band.id}-${side}`}>
                  <label>
                    Tête {sideLabel.toLowerCase()}
                    <select value={rule[typeKey] || ''} onChange={(event) => {
                      const nextEntry = entries.find((item) => item.type === event.target.value);
                      updateBand(band.id, { [typeKey]: event.target.value, [labelKey]: nextEntry?.label || `Tête ${sideLabel.toLowerCase()}` });
                    }}>
                      <option value="">Aucune</option>
                      {entries.map((entryOption) => <option key={entryOption.type} value={entryOption.type}>{entryOption.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Prix supplément HT
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={rule[priceKey] ?? ''}
                      placeholder={String(firstPriceValue(rule[priceKey], assetUnitPrice(entry, salonLabel), 0))}
                      onChange={(event) => updateBand(band.id, { [priceKey]: event.target.value })}
                    />
                  </label>
                </div>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}

function PresetAutoSpotsEditor({ rule, entries, width, depth, onChange }) {
  const area = Number(width || 0) * Number(depth || 0);
  const spotsNeeded = area > 0 ? Math.max(1, Math.round(area / ledSpotAreaMeters)) : 0;
  const spotsPerRail = Math.max(1, Number(rule?.spotsPerRail || 1));
  const railCount = area > 0 ? Math.max(1, Math.round(spotsNeeded / spotsPerRail)) : 0;

  return (
    <section className="preset-reserve-rules">
      <h4>Spots automatiques</h4>
      <p>Choisissez un objet de la boutique et indiquez le nombre de spots qu'il comporte. Les rails sont placés automatiquement selon la règle 1 spot pour {ledSpotAreaMeters} m².</p>
      <article>
        <label>
          Objet
          <select
            value={rule?.type || ''}
            onChange={(event) => {
              const next = event.target.value;
              if (!next) { onChange(null); return; }
              onChange({ ...(rule || {}), type: next });
            }}
          >
            <option value="">Aucun (désactivé)</option>
            {entries.map((entry) => (
              <option key={entry.type} value={entry.type}>{entry.label}</option>
            ))}
          </select>
        </label>
        {rule?.type && (
          <label>
            Spots par rail
            <input
              type="number"
              min="1"
              step="1"
              value={rule?.spotsPerRail ?? ''}
              placeholder="1"
              onChange={(event) => onChange({ ...(rule || {}), spotsPerRail: Number(event.target.value) || 1 })}
            />
          </label>
        )}
        {rule?.type && area > 0 && (
          <div className="preset-reserve-empty">
            Pour {width} × {depth} m ({area} m²) : {spotsNeeded} spots → {railCount} rail{railCount > 1 ? 's' : ''} de {spotsPerRail} spot{spotsPerRail > 1 ? 's' : ''}
          </div>
        )}
      </article>
    </section>
  );
}

function presetToEditableScene(preset, catalogEntries = []) {
  const items = (preset.stand_preset_items || []).map((item) => normalizePresetItem(item, catalogEntries));
  return {
    dimensions: {
      width: Number(preset.width_m || preset.base_config?.width || 5),
      depth: Number(preset.depth_m || preset.base_config?.depth || 5),
      height: fixedWallHeight,
    },
    layout: preset.layout || preset.base_config?.layout || 'u',
    items,
  };
}

function normalizePresetItem(item, catalogEntries = []) {
  const config = item.config || {};
  const catalogItem = findCatalogEntry(catalogEntries, item.type) || catalog.find((entry) => entry.type === item.type);
  const placementRule = hasOwn(config, 'placementRule')
    ? normalizePlacementRule(config.placementRule)
    : effectivePlacementRule(catalogItem);
  const isGroup = Boolean(config.isGroup || catalogItem?.isGroup);
  return {
    ...config,
    id: item.item_uid || config.id || `${item.type}-${item.id}`,
    type: item.type,
    label: item.label || config.label || catalogItem?.label || item.type,
    isGroup,
    groupSize: config.groupSize || catalogItem?.groupSize,
    children: isGroup ? resolveGroupChildren(config.children || catalogItem?.children || []) : config.children,
    placementRule,
    lockedPlacement: config.lockedPlacement ?? isLockedPlacementRule(placementRule),
    x: Number(item.x ?? config.x ?? 0),
    y: Number(item.y ?? config.y ?? 0),
    z: Number(item.z ?? config.z ?? 0),
    rotation: Number(item.rotation ?? config.rotation ?? 0),
    wall: item.wall || config.wall,
    isWallItem: config.isWallItem ?? catalogItem?.isWallItem,
    collisionEnabled: config.collisionEnabled ?? catalogItem?.collisionEnabled,
    modelUrl: config.modelUrl || catalogItem?.modelUrl,
    modelSize: config.modelSize || catalogItem?.modelSize,
    materialUrl: config.materialUrl || catalogItem?.materialUrl,
    dimensions: config.dimensions || catalogItem?.dimensions,
    color: config.color || catalogItem?.color,
  };
}

function SalonPreview({ salon }) {
  if (salon.cover_url) {
    return <img className="salon-card-preview" src={salon.cover_url} alt="" />;
  }

  const initials = salon.name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'SI';
  return <span className={`salon-card-preview generated ${salonStatusKind(salon)}`}>{initials}</span>;
}

function salonStatusKind(salon) {
  if (salon.status === 'active') return 'active';
  if (salon.status === 'upcoming') return 'upcoming';
  if (salon.status === 'archived') return 'archived';
  return 'draft';
}

function salonStatusLabel(status) {
  const labels = {
    active: 'Actif',
    upcoming: 'À venir',
    draft: 'À définir',
    archived: 'Archivé',
  };
  return labels[status] || 'À définir';
}

function formatSalonDateRange(salon) {
  if (!salon.starts_on && !salon.ends_on) return 'À définir';
  if (salon.starts_on && salon.ends_on) return `${formatDate(salon.starts_on)} → ${formatDate(salon.ends_on)}`;
  return formatDate(salon.starts_on || salon.ends_on);
}

function salonOfferSummary(salon) {
  const offers = salon.offers || [];
  const itemCount = (salon.presets || []).reduce((sum, preset) => sum + (preset.stand_preset_items?.length || 0), 0);
  if (!offers.length && !itemCount) return 'Configurations de stand à préparer';
  const offerText = offers.length ? offers.map((offer) => offer.name).join(' · ') : 'Aucune formule';
  return itemCount ? `${offerText} · ${itemCount} objet${itemCount > 1 ? 's' : ''} inclus` : offerText;
}

function salonExhibitorCount(salon) {
  const identifiers = new Set((salon.scenes || []).map((scene) => scene.client_id || scene.client_email || scene.client_name).filter(Boolean));
  return identifiers.size;
}

function salonConfigCount(salon) {
  return (salon.scenes || []).length;
}

function salonPendingBatCount(salon) {
  return (salon.scenes || []).filter((scene) => scene.status === 'bat_pending' || scene.client_status === 'bat_review').length;
}

function normalizeTextValue(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function presetArea(preset) {
  const width = Number(preset.width_m || preset.base_config?.width || 0);
  const depth = Number(preset.depth_m || preset.base_config?.depth || 0);
  return Math.round(width * depth);
}

function presetFaceCount(preset) {
  const layout = preset.layout || preset.base_config?.layout || 'u';
  if (layout === 'back') return 1;
  if (layout === 'left' || layout === 'right') return 2;
  return 3;
}

function presetReferenceLabel(preset, presets = []) {
  if (presets.length > 1) return `${presets.length} bases`;
  const area = presetArea(preset);
  return area ? `${area}m${presetFaceCount(preset)}F` : `${presetFaceCount(preset)}F`;
}

function presetMetaLabel(preset, presets = []) {
  if (presets.length > 1) {
    const totalModules = presets.reduce((sum, item) => sum + (item.stand_preset_items?.length || 0), 0);
    return `${presets.length} implantations · ${totalModules} module${totalModules > 1 ? 's' : ''} inclus`;
  }
  const area = presetArea(preset);
  const modules = preset.stand_preset_items?.length || 0;
  return `${area ? `${area} m²` : 'Surface à définir'} · ${presetFaceCount(preset)} face${presetFaceCount(preset) > 1 ? 's' : ''} · ${modules} module${modules > 1 ? 's' : ''}`;
}

function AdminClientsView({ clients, filters, updateFilter }) {
  return (
    <section className="admin-clients-view">
      <section className="admin-clients-search-card">
        <div>
          <Search size={16} />
          <input value={filters.search} placeholder="Nom exposant, salon, numéro de stand, commercial..." onChange={(event) => updateFilter('search', event.target.value)} />
        </div>
        <button type="button">Rechercher</button>
      </section>

      <div className="admin-client-filter-line">
        <span>Filtres actifs :</span>
        <label>Salon <input value={filters.salon} placeholder="Tous" onChange={(event) => updateFilter('salon', event.target.value)} /></label>
        <label>Statut <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">Tous</option><option value="created">Créé</option><option value="configured">Configuré</option><option value="bat_pending">BAT à valider</option><option value="validated">Validé</option></select></label>
      </div>

      <section className="admin-clients-table">
        <header>
          <span>Exposant</span>
          <span>Salons</span>
          <span>Configurations</span>
          <span>Surface</span>
          <span>Commercial</span>
          <span>Statut</span>
          <span>Actions</span>
        </header>
        {clients.length ? clients.map((client) => (
          <article key={client.id || client.client_key}>
            <div>
              <strong>{client.company_name || client.display_name || 'Exposant sans nom'}</strong>
              <small>{client.email || client.display_name || 'Email non renseigné'}</small>
            </div>
            <span>{clientSalonSummary(client)}</span>
            <span>{clientConfigSummary(client)}</span>
            <span>{clientSurfaceSummary(client)} m²</span>
            <span>{client.commercial_name || clientCommercialSummary(client) || '—'}</span>
            <span><i className={`client-status-badge ${clientStatusKind(client)}`}>{clientStatusSummary(client)}</i></span>
            <div className="client-row-actions">
              {clientPrimaryScene(client) ? <a href={sceneShareUrl(clientPrimaryScene(client))}>Voir</a> : <button type="button" disabled>Voir</button>}
            </div>
          </article>
        )) : <div className="admin-empty-row">Aucun exposant trouvé avec les filtres actuels.</div>}
      </section>
    </section>
  );
}

function clientPrimaryScene(client) {
  const scenes = client.scenes || [];
  return scenes
    .slice()
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
}

function clientSalonSummary(client) {
  const salons = [...new Set((client.scenes || []).map((scene) => normalizeSalonTitle(scene.event_name || scene.salon)).filter(Boolean))];
  if (!salons.length) return '—';
  if (salons.length <= 2) return salons.join(', ');
  return `${salons.slice(0, 2).join(', ')} +${salons.length - 2}`;
}

function clientConfigSummary(client) {
  const scenes = client.scenes || [];
  if (!scenes.length) return 'Aucune scène';
  const first = scenes[0];
  const label = first.project_name || first.monday_item_id || first.offer || 'Scène';
  return scenes.length === 1 ? label : `${scenes.length} scènes · ${label}`;
}

function clientSurfaceSummary(client) {
  return (client.scenes || []).reduce((sum, scene) => sum + sceneArea(scene), 0);
}

function clientCommercialSummary(client) {
  const commercials = [...new Set((client.scenes || []).map((scene) => scene.source_payload?.commercial_name || scene.source_payload?.commercial).filter(Boolean))];
  return commercials[0] || '';
}

function clientStatusKind(client) {
  const statuses = new Set((client.scenes || []).flatMap((scene) => [scene.status, scene.client_status]));
  if (statuses.has('validated') || statuses.has('bat_validated')) return 'success';
  if (statuses.has('bat_pending') || statuses.has('bat_review')) return 'warning';
  if (statuses.has('configured')) return 'purple';
  return 'neutral';
}

function clientStatusSummary(client) {
  const kind = clientStatusKind(client);
  if (kind === 'success') return 'BAT signé';
  if (kind === 'warning') return 'En attente Stand-ING';
  if (kind === 'purple') return 'Config soumise';
  return 'À configurer';
}

function AdminObjectsView({ assets, scenes, search, category, selectedAsset, uploadState, onCategoryChange, onSelectAsset, onCloseAsset, onSaveAsset, onDeleteAsset, onUploadAssetFolder, onUploadColorGroup }) {
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [variantGroupCreatorOpen, setVariantGroupCreatorOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState(search || '');
  const categories = ['Tout', 'Groupes', 'Groupes de variantes', 'Groupes de couleurs', ...assetCategoryOptions];
  const filteredAssets = assets.filter((asset) => {
    const assetCategory = assetCategoryLabel(asset);
    const matchesCategory = category === 'Tout' || assetCategory === category;
    const normalizedSearch = assetSearch.trim().toLowerCase();
    const matchesSearch = !normalizedSearch || [asset.label, asset.type, assetCategory].filter(Boolean).some((value) => value.toLowerCase().includes(normalizedSearch));
    return matchesCategory && matchesSearch;
  });

  return (
    <section className="admin-assets-view">
      <div className="asset-actions-row">
        <label className="asset-upload-drop">
          <Upload size={23} />
          <span>Ajouter un dossier OBJ complet</span>
          <strong>{uploadState?.loading ? 'Import en cours...' : 'Parcourir un dossier'}</strong>
          <small>Le dossier doit contenir l'OBJ, son .MTL et les textures. Les chemins relatifs sont conservés.</small>
          <input
            type="file"
            accept=".obj,.mtl,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tga,.tif,.tiff"
            multiple
            webkitdirectory=""
            directory=""
            disabled={uploadState?.loading}
            onChange={(event) => {
              onUploadAssetFolder(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        <label className="asset-upload-drop asset-upload-file">
          <Upload size={23} />
          <span>Importer un fichier GLB</span>
          <strong>{uploadState?.loading ? 'Import en cours...' : 'Choisir un .glb'}</strong>
          <small>Format recommandé : un seul fichier .glb contenant géométrie, matériaux et textures.</small>
          <input
            type="file"
            accept=".glb,model/gltf-binary"
            disabled={uploadState?.loading}
            onChange={(event) => {
              onUploadAssetFolder(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        <button className="asset-group-create-button" type="button" onClick={() => setGroupCreatorOpen(true)}>
          <Layers size={18} />
          Creer un groupe d'objets
        </button>
        <button className="asset-group-create-button" type="button" onClick={() => setVariantGroupCreatorOpen(true)}>
          <Settings2 size={18} />
          Creer un groupe de variantes
        </button>
        <label className="asset-group-create-button color-group-upload">
          <FileImage size={18} />
          Importer un groupe de couleurs
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            webkitdirectory=""
            directory=""
            disabled={uploadState?.loading}
            onChange={(event) => {
              onUploadColorGroup(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      {(uploadState?.message || uploadState?.error) && (
        <div className={`asset-upload-feedback ${uploadState.error ? 'error' : ''}`}>
          {uploadState.error || uploadState.message}
        </div>
      )}

      <label className="asset-search-box">
        <Search size={16} />
        <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Rechercher un asset 3D..." />
      </label>

      <nav className="asset-category-tabs" aria-label="Categories assets">
        {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => onCategoryChange(item)}>{item}</button>)}
      </nav>

      <div className="asset-grid">
        {filteredAssets.map((asset) => (
          <button key={asset.type} className="asset-card" type="button" onClick={() => onSelectAsset(asset)}>
            <span className={`asset-status-dot ${assetStatus(asset)}`} />
            <AssetPreview asset={asset} />
            <div className="asset-card-body">
              <strong>{asset.label}</strong>
              <span>{assetCategoryLabel(asset)}</span>
              <em>{assetSizeLabel(asset)}</em>
              <div className="asset-tags">
                {assetSalons(asset, scenes).slice(0, 2).map((salon) => <small key={salon}>{salonShortLabel(salon)}</small>)}
                {asset.dimensions?.adminOnly && <small className="admin-only">Admin</small>}
                {!asset.is_active && <small className="inactive">Inactif</small>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedAsset && (
        <AssetDrawer
          asset={selectedAsset}
          scenes={scenes}
          assets={assets}
          onClose={onCloseAsset}
          onSave={onSaveAsset}
          onDelete={() => onDeleteAsset(selectedAsset)}
        />
      )}
      {groupCreatorOpen && (
        <AssetGroupCreator
          assets={assets}
          scenes={scenes}
          onClose={() => setGroupCreatorOpen(false)}
          onCreate={async (groupAsset) => {
            const saved = await onSaveAsset(groupAsset);
            setGroupCreatorOpen(false);
            onSelectAsset(saved);
          }}
        />
      )}
      {variantGroupCreatorOpen && (
        <AssetVariantGroupCreator
          assets={assets}
          scenes={scenes}
          onClose={() => setVariantGroupCreatorOpen(false)}
          onCreate={async (groupAsset) => {
            const saved = await onSaveAsset(groupAsset);
            setVariantGroupCreatorOpen(false);
            onSelectAsset(saved);
          }}
        />
      )}
    </section>
  );
}

function AssetPreview({ asset }) {
  if (asset.dimensions?.isColorGroup) {
    const colors = normalizeColorGroupOptions(asset);
    return (
      <span className="asset-color-group-preview">
        {colors.slice(0, 5).map((color) => <i key={color.id} style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }} />)}
        <em>{colors.length} couleurs</em>
      </span>
    );
  }
  const url = asset.thumbnail_url;
  if (url) return <img className="asset-thumb" src={url} alt="" />;
  if (asset.dimensions?.isVariantGroup) return <span className="asset-group-preview"><Layers size={34} />{asset.dimensions?.variantAssetTypes?.length || 0} variantes</span>;
  if (asset.dimensions?.isGroup) return <span className="asset-group-preview"><Layers size={34} />{asset.dimensions?.children?.length || 0} objets</span>;
  if (asset.model_url?.toLowerCase().endsWith('.obj')) return <span className="asset-obj-preview" />;
  return <span className="asset-glb-preview">{assetFormat(asset)}</span>;
}

function AssetDrawer({ asset, assets, scenes, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(asset);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState('');
  const [batPictoUploading, setBatPictoUploading] = useState(false);
  const [batPictoError, setBatPictoError] = useState('');
  const [groupRows, setGroupRows] = useState(() => assetToGroupRows(asset));
  const [selectedGroupRowUid, setSelectedGroupRowUid] = useState(null);
  const salons = getSalonRows(scenes).map((salon) => salon.title);
  const assignedSalons = assetSalons(draft, scenes);
  const isColorGroup = Boolean(draft.dimensions?.isColorGroup);
  const isGroupAsset = Boolean(draft.dimensions?.isGroup);
  const isVariantGroup = Boolean(draft.dimensions?.isVariantGroup);
  const sourceAssets = groupSourceAssets(assets);
  const variantSourceAssetsList = variantSourceAssets(assets, draft.type);
  const fallbackType = sourceAssets[0]?.type || '';
  const activeGroupRowUid = selectedGroupRowUid || groupRows[0]?.uid || null;
  const draftPlacementRuleId = effectivePlacementRule(draft)?.id || 'free';
  const draftMountType = assetPlacementMode(draft);
  const draftCollisionDisabled = draft.dimensions?.collisionEnabled === false;
  const draftIsTelevision = Boolean(draft.dimensions?.isTelevision);
  const draftIsLedSpotOption = Boolean(draft.dimensions?.isLedSpotOption);
  const draftCeilingMounted = Boolean(draft.dimensions?.ceilingMounted);
  const draftMovementLocked = Boolean(draft.dimensions?.movementLocked);
  const draftDeleteLocked = Boolean(draft.dimensions?.deleteLocked);
  const draftRotationLocked = Boolean(draft.dimensions?.rotationLocked);
  const draftConfigOptions = normalizeAssetConfigOptions(draft.dimensions?.configOptions);
  const [variantAssetTypes, setVariantAssetTypes] = useState(() => draft.dimensions?.variantAssetTypes || []);
  const [variantOptionLinks, setVariantOptionLinks] = useState(() => draft.dimensions?.variantOptionLinks || []);

  useEffect(() => {
    setDraft(asset);
    setThumbnailUploading(false);
    setThumbnailError('');
    setBatPictoUploading(false);
    setBatPictoError('');
    setGroupRows(assetToGroupRows(asset));
    setVariantAssetTypes(asset.dimensions?.variantAssetTypes || []);
    setVariantOptionLinks(asset.dimensions?.variantOptionLinks || []);
    setSelectedGroupRowUid(null);
  }, [asset]);

  const setVariantOptionLink = (selectOptionId, choiceId, toggleOptionId, linkedType) => {
    setVariantOptionLinks((current) => {
      const filtered = current.filter(
        (link) => !(link.selectOptionId === selectOptionId && link.choiceId === choiceId && link.toggleOptionId === toggleOptionId),
      );
      return linkedType ? [...filtered, { selectOptionId, choiceId, toggleOptionId, linkedType }] : filtered;
    });
  };

  const toggleSalon = (salon) => {
    const current = new Set(assetSalons(draft, scenes));
    if (current.has(salon)) current.delete(salon);
    else current.add(salon);
    const nextSalons = [...current];
    setDraft({
      ...draft,
      is_active: nextSalons.length > 0,
      dimensions: {
        ...(draft.dimensions || {}),
        salons: nextSalons,
      },
    });
  };

  const updatePlacementRule = (ruleId) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        placementRule: placementRuleFromId(ruleId),
      },
    });
  };

  const updateAssetBehavior = (patch) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        ...patch,
      },
    });
  };

  const updateAssetList = (key, nextItems) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        [key]: nextItems,
      },
    });
  };

  const updateColorGroupBehavior = (patch) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        ...patch,
      },
    });
  };

  const toggleColorUsage = (usageId) => {
    const current = new Set(colorGroupUsages(draft));
    if (current.has(usageId)) current.delete(usageId);
    else current.add(usageId);
    updateColorGroupBehavior({ colorUsages: [...current] });
  };

  const setColorGroupDefault = (colorId) => {
    updateColorGroupBehavior({
      colorOptions: normalizeColorGroupOptions(draft).map((color) => ({
        ...color,
        isDefault: color.id === colorId,
      })),
    });
  };

  const toggleColorGroupFree = (colorId, checked) => {
    updateColorGroupBehavior({
      colorOptions: normalizeColorGroupOptions(draft).map((color) => (
        color.id === colorId ? { ...color, isFree: checked } : color
      )),
    });
  };

  const updateConfigOptionRow = (index, patch) => {
    const nextRows = draftConfigOptions.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return { ...row, ...patch };
    });
    updateAssetList('configOptions', nextRows);
  };

  const addConfigOptionRow = () => {
    updateAssetList('configOptions', [
      ...draftConfigOptions,
      { id: `option-${Date.now()}`, label: 'Nouvelle option', detail: '', price: 0, defaultChecked: false },
    ]);
  };

  const removeConfigOptionRow = (index) => {
    updateAssetList('configOptions', draftConfigOptions.filter((_, rowIndex) => rowIndex !== index));
  };

  const addConfigOptionChoice = (optionIndex) => {
    const nextRows = draftConfigOptions.map((row, rowIndex) => {
      if (rowIndex !== optionIndex) return row;
      const newChoice = { id: `choice-${Date.now()}`, label: '', assetType: '' };
      return { ...row, choices: [...(row.choices || []), newChoice] };
    });
    updateAssetList('configOptions', nextRows);
  };

  const updateConfigOptionChoice = (optionIndex, choiceIndex, patch) => {
    const nextRows = draftConfigOptions.map((row, rowIndex) => {
      if (rowIndex !== optionIndex) return row;
      const nextChoices = (row.choices || []).map((choice, ci) => (ci !== choiceIndex ? choice : { ...choice, ...patch }));
      return { ...row, choices: nextChoices };
    });
    updateAssetList('configOptions', nextRows);
  };

  const removeConfigOptionChoice = (optionIndex, choiceIndex) => {
    const nextRows = draftConfigOptions.map((row, rowIndex) => {
      if (rowIndex !== optionIndex) return row;
      return { ...row, choices: (row.choices || []).filter((_, ci) => ci !== choiceIndex) };
    });
    updateAssetList('configOptions', nextRows);
  };

  const updateTelevisionOption = (checked) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        isTelevision: checked,
        ...(checked ? { mountType: 'wall', wallY: screenCenterHeight, ceilingMounted: false, isLedSpotOption: false } : {}),
      },
    });
  };

  const updateLedSpotOption = (checked) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        isLedSpotOption: checked,
        ...(checked ? { mountType: 'wall', wallY: ledRailDefaultCenterY, isTelevision: false, ceilingMounted: false } : {}),
      },
    });
  };

  const updateCeilingMountedOption = (checked) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        ceilingMounted: checked,
        ceilingBottomY: checked ? ceilingObjectBottomY : draft.dimensions?.ceilingBottomY,
        ...(checked ? { mountType: 'floor', isTelevision: false, isLedSpotOption: false } : {}),
      },
    });
  };

  const updateSalonPricing = (salon, patch) => {
    const key = salonPricingKey(salon);
    const currentPricing = draft.dimensions?.salonPricing || {};
    const currentSalonPricing = currentPricing[key] || { salon, price: '', reference: '' };
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        salonPricing: {
          ...currentPricing,
          [key]: {
            ...currentSalonPricing,
            salon,
            ...patch,
          },
        },
      },
    });
  };

  const updateGroupRow = (uid, patch) => {
    setGroupRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  };

  const removeGroupRow = (uid) => {
    setGroupRows((current) => current.filter((row) => row.uid !== uid));
    if (activeGroupRowUid === uid) setSelectedGroupRowUid(groupRows.find((row) => row.uid !== uid)?.uid || null);
  };

  const saveDraft = () => {
    if (isColorGroup) {
      onSave({
        ...draft,
        label: draft.label?.trim() || 'Groupe de couleurs',
        is_active: assignedSalons.length > 0,
        dimensions: {
          ...(draft.dimensions || {}),
          isColorGroup: true,
          category: 'Groupes de couleurs',
          colorOptions: normalizeColorGroupOptions(draft),
          colorUsages: colorGroupUsages(draft),
          colorGroupPrice: Number(draft.dimensions?.colorGroupPrice || 0),
          colorGroupReference: draft.dimensions?.colorGroupReference || '',
          configOptions: draftConfigOptions,
        },
      });
      return;
    }

    if (isVariantGroup) {
      const cleanTypes = variantAssetTypes.filter(Boolean);
      const selectChoiceTypes = draftConfigOptions
        .filter((o) => o.type === 'select')
        .flatMap((o) => (o.choices || []).map((c) => c.assetType).filter(Boolean));
      const allTypes = [...new Set([...cleanTypes, ...selectChoiceTypes])];
      onSave({
        ...draft,
        label: draft.label?.trim() || 'Groupe de variantes',
        dimensions: {
          ...(draft.dimensions || {}),
          isVariantGroup: true,
          category: draft.dimensions?.category || 'Mobilier',
          variantAssetTypes: allTypes,
          configOptions: draftConfigOptions,
          variantOptionLinks,
          format: 'Groupe de variantes',
        },
      });
      return;
    }

    if (!isGroupAsset) {
      onSave(draft);
      return;
    }

    const children = buildGroupChildren(groupRows, sourceAssets);
    if (!children.length) return;
    onSave({
      ...draft,
      label: draft.label?.trim() || "Groupe d'objets",
      dimensions: {
        ...(draft.dimensions || {}),
        isGroup: true,
        category: 'Groupes',
        groupSize: computeGroupSize(children),
        children,
        format: 'Groupe',
      },
    });
  };

  const changeThumbnail = async (file) => {
    if (!file) return;
    setThumbnailUploading(true);
    setThumbnailError('');
    try {
      const updated = await uploadObjectAssetThumbnail(draft, file);
      const saved = await onSave(updated);
      setDraft(saved);
    } catch (error) {
      setThumbnailError(error.message || "Upload de l'image impossible.");
    } finally {
      setThumbnailUploading(false);
    }
  };

  const changeBatPicto = async (file) => {
    if (!file) return;
    setBatPictoUploading(true);
    setBatPictoError('');
    try {
      const updated = await uploadObjectAssetBatPicto(draft, file);
      const saved = await onSave(updated);
      setDraft(saved);
    } catch (error) {
      setBatPictoError(error.message || "Upload du picto impossible.");
    } finally {
      setBatPictoUploading(false);
    }
  };

  return (
    <div className="asset-drawer-layer">
      <aside className="asset-drawer">
        <header>
          <div>
            <h2>{draft.label}</h2>
            <span>{assetCategoryLabel(draft)}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </header>

        <AssetPreview asset={draft} />

        <label className="asset-thumbnail-edit">
          <FileImage size={18} />
          <span>
            <strong>{thumbnailUploading ? "Image en cours d'envoi..." : "Image de l'objet"}</strong>
            <small>{draft.thumbnail_url ? "Remplacer l'image qui représente cet objet." : "Ajouter une image pour représenter cet objet."}</small>
            {thumbnailError && <em>{thumbnailError}</em>}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={thumbnailUploading}
            onChange={(event) => {
              changeThumbnail(event.target.files?.[0] || null);
              event.target.value = '';
            }}
          />
        </label>

        {!isColorGroup && !isVariantGroup && (
        <label className="asset-thumbnail-edit">
          <FileImage size={18} />
          <span>
            <strong>{batPictoUploading ? "Picto en cours d'envoi..." : "Picto plan BAT"}</strong>
            <small>{draft.dimensions?.batPictoUrl ? "Remplacer le picto affiché sur le plan technique BAT." : "Ajouter un picto pour le plan technique BAT (remplace la vue 3D)."}</small>
            {draft.dimensions?.batPictoUrl && !batPictoUploading && <em className="bat-picto-ok">Picto importé ✓</em>}
            {batPictoError && <em>{batPictoError}</em>}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={batPictoUploading}
            onChange={(event) => {
              changeBatPicto(event.target.files?.[0] || null);
              event.target.value = '';
            }}
          />
        </label>
        )}

        <label className="asset-group-field">
          <span>Nom</span>
          <input value={draft.label || ''} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
        </label>

        {!isColorGroup && (
        <label className="asset-group-field">
          <span>Nom EN (traduction)</span>
          <input
            value={draft.dimensions?.labelEn || ''}
            placeholder={draft.label || ''}
            onChange={(event) => setDraft({ ...draft, dimensions: { ...(draft.dimensions || {}), labelEn: event.target.value } })}
          />
        </label>
        )}

        {!isGroupAsset && !isColorGroup && (
          <label className="asset-group-field">
            <span>Catégorie</span>
            <select
              value={draft.dimensions?.category || assetCategoryLabel(draft)}
              onChange={(event) => updateAssetBehavior({ category: event.target.value })}
            >
              {assetCategoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )}

        {!isColorGroup && (
        <label className="asset-toggle-row">
          <input
            type="checkbox"
            checked={Boolean(draft.dimensions?.adminOnly)}
            onChange={(event) => updateAssetBehavior({ adminOnly: event.target.checked })}
          />
          <span>
            <strong>Admin seulement</strong>
            <small>Si activé, seuls les admins peuvent poser cet objet dans une scène.</small>
          </span>
        </label>
        )}

        {isColorGroup && (
          <section className="asset-color-settings">
            <div className="asset-color-settings-head">
              <h3>Groupe de couleurs</h3>
              <small>Coche les endroits où ce groupe apparaît, la couleur de base appliquée au chargement, puis les couleurs gratuites. Les autres couleurs seront facturées au prix HT/m² du groupe.</small>
            </div>
            <div className="color-group-usage-grid">
              {colorGroupUsageOptions.map((usage) => (
                <label key={usage.id} className="asset-toggle-row">
                  <input
                    type="checkbox"
                    checked={colorGroupUsages(draft).includes(usage.id)}
                    onChange={() => toggleColorUsage(usage.id)}
                  />
                  <span>
                    <strong>{usage.label}</strong>
                    <small>{usage.detail}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="asset-color-price-grid">
              <label className="asset-group-field">
                <span>Prix du groupe HT / m²</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.dimensions?.colorGroupPrice ?? 0}
                  onChange={(event) => updateColorGroupBehavior({ colorGroupPrice: event.target.value })}
                />
              </label>
              <label className="asset-group-field">
                <span>Référence du groupe</span>
                <input
                  value={draft.dimensions?.colorGroupReference || ''}
                  placeholder="Ex : MOQ-GRIS-PLUS"
                  onChange={(event) => updateColorGroupBehavior({ colorGroupReference: event.target.value })}
                />
              </label>
            </div>
            <div className="color-group-preview-list">
              {normalizeColorGroupOptions(draft).map((color) => (
                <span key={color.id} className={color.isDefault ? 'is-default' : ''}>
                  <i style={{ '--swatch-color': color.hex, '--swatch-image': `url("${color.image}")` }} />
                  <strong>{color.name}</strong>
                  <small>{color.code}</small>
                  <label>
                    <input
                      type="radio"
                      name={`default-color-${draft.type}`}
                      checked={color.isDefault}
                      onChange={() => setColorGroupDefault(color.id)}
                    />
                    Base
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={color.isDefault || color.isFree}
                      disabled={color.isDefault}
                      onChange={(event) => toggleColorGroupFree(color.id, event.target.checked)}
                    />
                    Gratuite
                  </label>
                </span>
              ))}
            </div>

            <div className="asset-variants-head compact">
              <div>
                <h3>Options supplémentaires</h3>
                <small>Options activables dans l'interface client (ex : épaisseur premium). Supplément HT en plus du prix/m².</small>
              </div>
              <button type="button" onClick={addConfigOptionRow}><Plus size={14} /> Option</button>
            </div>
            <AssetConfigOptionRows
              rows={draftConfigOptions}
              emptyLabel="Aucune option configurée pour ce groupe."
              onChange={updateConfigOptionRow}
              onRemove={removeConfigOptionRow}
            />
          </section>
        )}

        {!isVariantGroup && !isColorGroup && (
        <section className="asset-behavior-settings">
          <h3>Règles spécifiques</h3>
          {!isGroupAsset && (
            <label>
              <span>Type de placement</span>
              <select value={draftMountType} onChange={(event) => updateAssetBehavior({ mountType: event.target.value })}>
                <option value="floor">Objet au sol</option>
                <option value="wall">Objet rattaché à un mur</option>
              </select>
            </label>
          )}
          {!isGroupAsset && (
            <label className="asset-toggle-row">
              <input
                type="checkbox"
                checked={draftIsTelevision}
                onChange={(event) => updateTelevisionOption(event.target.checked)}
              />
              <span>
                <strong>Option télé</strong>
                <small>Coche pour rattacher automatiquement cet objet au mur, centre à 1,60 m du sol.</small>
              </span>
            </label>
          )}
          {!isGroupAsset && (
            <label className="asset-toggle-row">
              <input
                type="checkbox"
                checked={draftIsLedSpotOption}
                onChange={(event) => updateLedSpotOption(event.target.checked)}
              />
              <span>
                <strong>Option spot</strong>
                <small>Coche pour utiliser cet objet comme spot automatique, placé tout en haut du mur.</small>
              </span>
            </label>
          )}
          <label className="asset-toggle-row">
            <input
              type="checkbox"
              checked={draftCeilingMounted}
              onChange={(event) => updateCeilingMountedOption(event.target.checked)}
            />
            <span>
              <strong>Objet au plafond</strong>
              <small>Place le bas de l'objet à 3,00 m de hauteur, avec déplacement libre en X/Z.</small>
            </span>
          </label>
          <label>
            <span>Position automatique</span>
            <select value={draftPlacementRuleId} onChange={(event) => updatePlacementRule(event.target.value)}>
              {placementRuleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <small>{placementRuleLabel(draftPlacementRuleId, true)}</small>
          <label className="asset-toggle-row">
            <input
              type="checkbox"
              checked={draftMovementLocked}
              onChange={(event) => updateAssetBehavior({ movementLocked: event.target.checked })}
            />
            <span>
              <strong>Désactiver le déplacement</strong>
              <small>L'exposant pourra sélectionner l'objet, mais pas le déplacer.</small>
            </span>
          </label>
          <label className="asset-toggle-row">
            <input
              type="checkbox"
              checked={draftDeleteLocked}
              onChange={(event) => updateAssetBehavior({ deleteLocked: event.target.checked })}
            />
            <span>
              <strong>Désactiver la suppression</strong>
              <small>L'exposant ne pourra pas supprimer cet objet depuis sa scène.</small>
            </span>
          </label>
          <label className="asset-toggle-row">
            <input
              type="checkbox"
              checked={draftRotationLocked}
              onChange={(event) => updateAssetBehavior({ rotationLocked: event.target.checked })}
            />
            <span>
              <strong>Désactiver la rotation</strong>
              <small>L'exposant pourra sélectionner l'objet, mais pas changer son angle.</small>
            </span>
          </label>
          {!isGroupAsset && (
            <label className="asset-toggle-row">
              <input
                type="checkbox"
                checked={draftCollisionDisabled}
                onChange={(event) => updateAssetBehavior({ collisionEnabled: !event.target.checked })}
              />
              <span>
                <strong>Désactiver la collision</strong>
                <small>Coche cette option pour permettre de poser ou déplacer des objets au travers/en dessous.</small>
              </span>
            </label>
          )}
          {!isGroupAsset && (
            <label className="asset-toggle-row">
              <input
                type="checkbox"
                checked={Boolean(draft.dimensions?.depthLocked6cm)}
                onChange={(event) => updateAssetBehavior({ depthLocked6cm: event.target.checked || undefined })}
              />
              <span>
                <strong>Profondeur 6 cm (arrière)</strong>
                <small>Limite la profondeur de l'objet à 6 cm depuis sa face arrière pour le calcul des collisions et des affiches.</small>
              </span>
            </label>
          )}
        </section>
        )}

        {isVariantGroup && (
          <section className="asset-variants-settings">
            <div className="asset-variants-head">
              <div>
                <h3>Objets associés au groupe</h3>
                <small>Sélectionne les vrais objets 3D qui deviendront les variantes proposées dans la boutique.</small>
              </div>
              <button type="button" onClick={() => setVariantAssetTypes((current) => [...current, variantSourceAssetsList.find((asset) => !current.includes(asset.type))?.type || variantSourceAssetsList[0]?.type || ''])}>
                <Plus size={14} /> Objet
              </button>
            </div>
            <AssetVariantSourceRows
              rows={variantAssetTypes}
              sourceAssets={variantSourceAssetsList}
              onChange={(index, type) => setVariantAssetTypes((current) => current.map((item, itemIndex) => (itemIndex === index ? type : item)))}
              onRemove={(index) => setVariantAssetTypes((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            />

            <div className="asset-variants-head compact">
              <div>
                <h3>Options payantes</h3>
                <small>Chaque option s'affichera dans la popup comme une ligne activable avec supplément HT.</small>
              </div>
              <button type="button" onClick={addConfigOptionRow}><Plus size={14} /> Option</button>
            </div>
            <AssetConfigOptionRows
              rows={draftConfigOptions}
              emptyLabel="Aucune option configurée."
              sourceAssets={variantSourceAssetsList.filter((a) => variantAssetTypes.includes(a.type))}
              links={variantOptionLinks}
              onChange={updateConfigOptionRow}
              onRemove={removeConfigOptionRow}
              onAddChoice={addConfigOptionChoice}
              onUpdateChoice={updateConfigOptionChoice}
              onRemoveChoice={removeConfigOptionChoice}
              onSetLink={setVariantOptionLink}
            />
          </section>
        )}

        <dl className="asset-meta-card">
          <div><dt>Nom</dt><dd>{draft.label}</dd></div>
          <div><dt>Catégorie</dt><dd>{assetCategoryLabel(draft)}</dd></div>
          <div><dt>Format</dt><dd>{assetFormat(draft)}{assetFormat(draft) === 'OBJ' ? ' (converti depuis OBJ)' : ''}</dd></div>
          <div><dt>Taille</dt><dd>{assetSizeLabel(draft)}</dd></div>
          <div><dt>Dimensions</dt><dd>{assetDimensionsLabel(draft)}</dd></div>
          <div><dt>Ajouté le</dt><dd>{formatDate(draft.created_at)}</dd></div>
          <div><dt>Ajouté par</dt><dd>{draft.dimensions?.addedBy || 'Stand-ING'}</dd></div>
        </dl>

        <section className="asset-assignment">
          <h3>Affectation par salon</h3>
          {(salons.length ? salons : ['SMCL 2026']).map((salon) => {
            const active = assignedSalons.includes(salon);
            const salonPricing = getSalonPricing(draft, salon);
            return (
              <div key={salon} className="asset-salon-pricing-row">
                <button type="button" onClick={() => toggleSalon(salon)}>
                  <strong>{salon}</strong>
                  <span>{active ? 'Actif' : 'Inactif'}</span>
                  <i className={active ? 'active' : ''} />
                </button>
                {active && !isVariantGroup && !isColorGroup && (
                  <div className="asset-salon-pricing-fields">
                    <label>
                      <span>Prix spécifique {salon}</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={salonPricing.price ?? ''}
                        placeholder="—"
                        onChange={(event) => updateSalonPricing(salon, { price: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Référence</span>
                      <input
                        value={salonPricing.reference || ''}
                        placeholder="Ex : A4ENINJCSJKCSBJ"
                        onChange={(event) => updateSalonPricing(salon, { reference: event.target.value })}
                      />
                    </label>
                  </div>
                )}
                {active && isVariantGroup && (
                  <small className="asset-variant-group-note">Prix et référence gérés par les objets variantes.</small>
                )}
                {active && isColorGroup && (
                  <small className="asset-variant-group-note">Prix et référence gérés au niveau du groupe de couleurs.</small>
                )}
              </div>
            );
          })}
        </section>

        {isGroupAsset && (
          <>
            <section className="asset-group-builder">
              <h3>Composition du groupe</h3>
              <p>Tu peux modifier les objets, leur position X/Z et les déplacer directement sur le mini-plan, avec un pas précis de 1 cm.</p>
              <MiniGroupPlan
                rows={groupRows}
                sourceAssets={sourceAssets}
                selectedUid={activeGroupRowUid}
                onSelect={setSelectedGroupRowUid}
                onMove={(uid, position) => updateGroupRow(uid, position)}
              />
              {groupRows.map((row) => {
                const selectedSource = sourceAssets.find((source) => source.type === row.type);
                return (
                  <article key={row.uid} className={`asset-group-row ${activeGroupRowUid === row.uid ? 'active' : ''}`} onClick={() => setSelectedGroupRowUid(row.uid)}>
                    <label>
                      <span>Objet</span>
                      <select value={row.type} onChange={(event) => updateGroupRow(row.uid, { type: event.target.value, label: '' })}>
                        {sourceAssets.map((source) => <option key={source.type} value={source.type}>{source.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Libellé plan</span>
                      <input value={row.label || selectedSource?.label || ''} onChange={(event) => updateGroupRow(row.uid, { label: event.target.value })} />
                    </label>
                    <label><span>X m</span><input type="number" step={assetGroupPlacementStep} value={row.x} onChange={(event) => updateGroupRow(row.uid, { x: event.target.value })} /></label>
                    <label><span>Z m</span><input type="number" step={assetGroupPlacementStep} value={row.z} onChange={(event) => updateGroupRow(row.uid, { z: event.target.value })} /></label>
                    <label><span>Rotation</span><input type="number" step="5" value={row.rotation} onChange={(event) => updateGroupRow(row.uid, { rotation: event.target.value })} /></label>
                    <label title="Profondeur 6 cm (arrière)"><span>6 cm</span><input type="checkbox" checked={Boolean(row.depthLocked6cm)} onChange={(event) => updateGroupRow(row.uid, { depthLocked6cm: event.target.checked || undefined })} /></label>
                    <button type="button" onClick={() => removeGroupRow(row.uid)} disabled={groupRows.length <= 1}><Trash2 size={14} /></button>
                  </article>
                );
              })}
              <button type="button" className="asset-group-add-row" onClick={() => {
                const uid = `group-row-${Date.now()}`;
                setGroupRows((current) => [...current, { uid, type: fallbackType, x: 0, z: 0, rotation: 0 }]);
                setSelectedGroupRowUid(uid);
              }}>
                <Plus size={14} /> Ajouter un objet au groupe
              </button>
            </section>
          </>
        )}

        <small className="asset-price-note">
          {isColorGroup
            ? 'Ce groupe alimente les couleurs disponibles dans le configurateur selon ses usages et salons actifs.'
            : isVariantGroup
              ? 'Le groupe sert uniquement de fiche boutique : les prix et références viennent des objets associés.'
              : 'Les prix et références peuvent être différents pour chaque salon actif.'}
        </small>

        <footer>
          <button type="button" className="asset-delete" onClick={onDelete}>Supprimer définitivement</button>
          <button type="button" className="asset-save" onClick={saveDraft}>Enregistrer les modifications</button>
        </footer>
      </aside>
    </div>
  );
}

function AssetConfigOptionRows({ rows, emptyLabel, sourceAssets = [], links = [], onChange, onRemove, onAddChoice, onUpdateChoice, onRemoveChoice, onSetLink }) {
  if (!rows.length) return <p className="asset-variants-empty">{emptyLabel}</p>;
  const selectOption = rows.find((r) => r.type === 'select');
  return (
    <div className="asset-variant-list">
      {rows.map((row, index) => {
        const isSelect = row.type === 'select';
        const isToggle = !isSelect;
        return (
          <article key={`${row.id}-${index}`} className={`asset-variant-row option-row ${isSelect ? 'option-row-select' : ''}`}>
            <div className="option-row-fields">
              <div className="option-type-tabs">
                <button
                  type="button"
                  className={!isSelect ? 'active' : ''}
                  onClick={() => onChange(index, { type: 'toggle', choices: undefined })}
                  title="Case à cocher"
                >Case à cocher</button>
                <button
                  type="button"
                  className={isSelect ? 'active' : ''}
                  onClick={() => onChange(index, { type: 'select', choices: row.choices || [] })}
                  title="Sélection exclusive"
                >Sélection</button>
              </div>
              <label>
                <span>Nom</span>
                <input value={row.label || ''} onChange={(event) => onChange(index, { label: event.target.value })} placeholder={isSelect ? 'Ex : Taille' : 'Ex : Sur pied'} />
              </label>
              {isToggle && (
                <>
                  <label>
                    <span>Description</span>
                    <input value={row.detail || ''} onChange={(event) => onChange(index, { detail: event.target.value })} placeholder="Texte secondaire" />
                  </label>
                  <label>
                    <span>Supplément HT</span>
                    <input type="number" min="0" step="1" value={row.price ?? 0} onChange={(event) => onChange(index, { price: event.target.value })} />
                  </label>
                  <label className="asset-toggle-row asset-variant-default">
                    <input type="checkbox" checked={Boolean(row.defaultChecked)} onChange={(event) => onChange(index, { defaultChecked: event.target.checked })} />
                    <span><strong>Cochée par défaut</strong><small>L'option est active à l'ouverture.</small></span>
                  </label>
                </>
              )}
              <button type="button" onClick={() => onRemove(index)} aria-label="Supprimer cette option"><Trash2 size={14} /></button>
            </div>

            {isSelect && (
              <div className="option-variant-links">
                <div className="option-variant-links-head">
                  <span className="option-variant-links-label">Choix proposés au client</span>
                  <button type="button" className="option-add-choice" onClick={() => onAddChoice?.(index)}><Plus size={12} /> Choix</button>
                </div>
                {(row.choices || []).length === 0 && <p className="asset-variants-empty" style={{ margin: '4px 0' }}>Aucun choix — ajoute-en un.</p>}
                {(row.choices || []).map((choice, choiceIndex) => (
                  <div key={choice.id || choiceIndex} className="option-choice-row">
                    <input
                      value={choice.label || ''}
                      placeholder="Libellé (ex : 15&quot;)"
                      onChange={(event) => onUpdateChoice?.(index, choiceIndex, { label: event.target.value })}
                    />
                    <select
                      value={choice.assetType || ''}
                      onChange={(event) => onUpdateChoice?.(index, choiceIndex, { assetType: event.target.value })}
                    >
                      <option value="">— Objet lié —</option>
                      {sourceAssets.map((source) => (
                        <option key={source.type} value={source.type}>{source.label}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => onRemoveChoice?.(index, choiceIndex)} aria-label="Supprimer ce choix"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            {isToggle && selectOption && (selectOption.choices || []).length > 0 && (
              <div className="option-variant-links">
                <span className="option-variant-links-label">Objet placé selon la sélection</span>
                {(selectOption.choices || []).map((choice) => {
                  const currentLink = links.find(
                    (link) => link.selectOptionId === selectOption.id && link.choiceId === choice.id && link.toggleOptionId === row.id,
                  );
                  return (
                    <label key={choice.id} className="option-variant-link-row">
                      <span>{choice.label || choice.id}</span>
                      <select
                        value={currentLink?.linkedType || ''}
                        onChange={(event) => onSetLink?.(selectOption.id, choice.id, row.id, event.target.value)}
                      >
                        <option value="">— Aucun —</option>
                        {sourceAssets.map((source) => (
                          <option key={source.type} value={source.type}>{source.label}</option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function AssetVariantSourceRows({ rows, sourceAssets, onChange, onRemove }) {
  if (!sourceAssets.length) return <p className="asset-variants-empty">Aucun objet disponible pour créer des variantes.</p>;
  if (!rows.length) return <p className="asset-variants-empty">Aucun objet associé : ce groupe ne s'affichera pas encore dans la boutique.</p>;
  return (
    <div className="asset-variant-list">
      {rows.map((type, index) => {
        const selectedSource = sourceAssets.find((asset) => asset.type === type) || sourceAssets[0];
        return (
          <article key={`${type}-${index}`} className="asset-variant-row source-row">
            <label>
              <span>Objet variante</span>
              <select value={type} onChange={(event) => onChange(index, event.target.value)}>
                {sourceAssets.map((source) => <option key={source.type} value={source.type}>{source.label}</option>)}
              </select>
            </label>
            <div>
              <span>{selectedSource?.thumbnail_url ? <img src={selectedSource.thumbnail_url} alt="" /> : <Box size={20} />}</span>
              <strong>{selectedSource?.label || 'Objet'}</strong>
              <small>{assetCategoryLabel(selectedSource || {})} · {assetSizeLabel(selectedSource || {})}</small>
            </div>
            <button type="button" onClick={() => onRemove(index)} aria-label="Retirer cet objet"><Trash2 size={14} /></button>
          </article>
        );
      })}
    </div>
  );
}


function AssetVariantGroupCreator({ assets, scenes, onClose, onCreate }) {
  const sourceAssets = variantSourceAssets(assets);
  const fallbackType = sourceAssets[0]?.type || '';
  const [name, setName] = useState('Nouveau groupe de variantes');
  const [category, setCategory] = useState('Mobilier');
  const [rows, setRows] = useState(fallbackType ? [fallbackType] : []);
  const [configOptions, setConfigOptions] = useState([]);
  const [variantOptionLinks, setVariantOptionLinks] = useState([]);
  const [assignedSalons, setAssignedSalons] = useState(() => getSalonRows(scenes).map((salon) => salon.title).slice(0, 1));
  const [saving, setSaving] = useState(false);

  const toggleSalon = (salon) => {
    setAssignedSalons((current) => (current.includes(salon) ? current.filter((item) => item !== salon) : [...current, salon]));
  };

  const updateConfigOptionRow = (index, patch) => {
    setConfigOptions((current) => current.map((row, rowIndex) => (rowIndex !== index ? row : { ...row, ...patch })));
  };

  const addConfigOptionRow = () => {
    setConfigOptions((current) => [
      ...current,
      { id: `option-${Date.now()}`, label: 'Nouvelle option', detail: '', price: 0, defaultChecked: false },
    ]);
  };

  const setVariantOptionLink = (selectOptionId, choiceId, toggleOptionId, linkedType) => {
    setVariantOptionLinks((current) => {
      const filtered = current.filter(
        (link) => !(link.selectOptionId === selectOptionId && link.choiceId === choiceId && link.toggleOptionId === toggleOptionId),
      );
      return linkedType ? [...filtered, { selectOptionId, choiceId, toggleOptionId, linkedType }] : filtered;
    });
  };

  const addConfigOptionChoice = (optionIndex) => {
    setConfigOptions((current) => current.map((row, rowIndex) => {
      if (rowIndex !== optionIndex) return row;
      return { ...row, choices: [...(row.choices || []), { id: `choice-${Date.now()}`, label: '', assetType: '' }] };
    }));
  };

  const updateConfigOptionChoice = (optionIndex, choiceIndex, patch) => {
    setConfigOptions((current) => current.map((row, rowIndex) => {
      if (rowIndex !== optionIndex) return row;
      const nextChoices = (row.choices || []).map((choice, ci) => (ci !== choiceIndex ? choice : { ...choice, ...patch }));
      return { ...row, choices: nextChoices };
    }));
  };

  const removeConfigOptionChoice = (optionIndex, choiceIndex) => {
    setConfigOptions((current) => current.map((row, rowIndex) => {
      if (rowIndex !== optionIndex) return row;
      return { ...row, choices: (row.choices || []).filter((_, ci) => ci !== choiceIndex) };
    }));
  };

  const saveGroup = async () => {
    setSaving(true);
    const cleanRows = [...new Set(rows.filter(Boolean))];
    const selectChoiceTypes = configOptions
      .filter((o) => o.type === 'select')
      .flatMap((o) => (o.choices || []).map((c) => c.assetType).filter(Boolean));
    const allTypes = [...new Set([...cleanRows, ...selectChoiceTypes])];
    await onCreate({
      type: `variant-group-${slugForType(name)}-${Date.now().toString(36)}`,
      label: name.trim() || 'Groupe de variantes',
      model_url: null,
      thumbnail_url: null,
      is_active: assignedSalons.length > 0,
      dimensions: {
        isVariantGroup: true,
        category,
        variantAssetTypes: allTypes,
        configOptions,
        variantOptionLinks,
        salons: assignedSalons,
        addedBy: 'Admin Stand-ING',
        format: 'Groupe de variantes',
      },
    });
    setSaving(false);
  };

  return (
    <div className="asset-drawer-layer">
      <aside className="asset-drawer asset-group-drawer">
        <header>
          <div>
            <h2>Créer un groupe de variantes</h2>
            <span>Une fiche boutique, plusieurs objets 3D réels.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </header>

        <label className="asset-group-field">
          <span>Nom du groupe</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Téléviseurs LCD" />
        </label>

        <label className="asset-group-field">
          <span>Catégorie boutique</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {assetCategoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>

        <section className="asset-variants-settings">
          <div className="asset-variants-head">
            <div>
              <h3>Objets variantes</h3>
              <small>Exemple : TV 32, TV 43, TV 65. Ce sont ces objets qui seront réellement posés sur la scène.</small>
            </div>
            <button type="button" onClick={() => setRows((current) => [...current, sourceAssets.find((asset) => !current.includes(asset.type))?.type || fallbackType])} disabled={!sourceAssets.length}>
              <Plus size={14} /> Objet
            </button>
          </div>
          <AssetVariantSourceRows
            rows={rows}
            sourceAssets={sourceAssets}
            onChange={(index, type) => setRows((current) => current.map((item, itemIndex) => (itemIndex === index ? type : item)))}
            onRemove={(index) => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          />
        </section>

        <section className="asset-variants-settings">
          <div className="asset-variants-head">
            <div>
              <h3>Options</h3>
              <small>Ces lignes seront activables dans la popup. Supplément à 0 si l'option change seulement l'objet posé.</small>
            </div>
            <button type="button" onClick={addConfigOptionRow}><Plus size={14} /> Option</button>
          </div>
          <AssetConfigOptionRows
            rows={configOptions}
            emptyLabel="Aucune option configurée."
            sourceAssets={sourceAssets.filter((a) => rows.filter(Boolean).includes(a.type))}
            links={variantOptionLinks}
            onChange={updateConfigOptionRow}
            onRemove={(index) => setConfigOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            onAddChoice={addConfigOptionChoice}
            onUpdateChoice={updateConfigOptionChoice}
            onRemoveChoice={removeConfigOptionChoice}
            onSetLink={setVariantOptionLink}
          />
        </section>

        <section className="asset-assignment">
          <h3>Affectation par salon</h3>
          {(getSalonRows(scenes).map((salon) => salon.title).length ? getSalonRows(scenes).map((salon) => salon.title) : ['SMCL 2026']).map((salon) => {
            const active = assignedSalons.includes(salon);
            return (
              <button key={salon} type="button" onClick={() => toggleSalon(salon)}>
                <strong>{salon}</strong>
                <span>{active ? 'Actif' : 'Inactif'}</span>
                <i className={active ? 'active' : ''} />
              </button>
            );
          })}
        </section>

        <footer>
          <button type="button" className="asset-delete" onClick={onClose}>Annuler</button>
          <button type="button" className="asset-save" disabled={saving || !rows.filter(Boolean).length} onClick={saveGroup}>
            {saving ? 'Création...' : 'Créer le groupe'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function AssetGroupCreator({ assets, scenes, onClose, onCreate }) {
  const sourceAssets = groupSourceAssets(assets);
  const fallbackType = sourceAssets[0]?.type || '';
  const [name, setName] = useState('Nouveau groupe');
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([
    { uid: `group-row-${Date.now()}-1`, type: fallbackType, x: -0.4, z: 0, rotation: 0 },
    { uid: `group-row-${Date.now()}-2`, type: fallbackType, x: 0.4, z: 0, rotation: 0 },
  ]);
  const [selectedRowUid, setSelectedRowUid] = useState(null);
  const activeRowUid = selectedRowUid || rows[0]?.uid || null;
  const [assignedSalons, setAssignedSalons] = useState(() => getSalonRows(scenes).map((salon) => salon.title).slice(0, 1));
  const [placementRuleId, setPlacementRuleId] = useState('free');

  const updateRow = (uid, patch) => {
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  };

  const removeRow = (uid) => {
    setRows((current) => current.filter((row) => row.uid !== uid));
    if (activeRowUid === uid) setSelectedRowUid(rows.find((row) => row.uid !== uid)?.uid || null);
  };

  const toggleSalon = (salon) => {
    setAssignedSalons((current) => (current.includes(salon) ? current.filter((item) => item !== salon) : [...current, salon]));
  };

  const saveGroup = async () => {
    const children = buildGroupChildren(rows, sourceAssets);

    if (!children.length) return;
    setSaving(true);
    await onCreate({
      type: `group-${slugForType(name)}-${Date.now().toString(36)}`,
      label: name.trim() || "Groupe d'objets",
      model_url: null,
      thumbnail_url: null,
      is_active: true,
      dimensions: {
        category: 'Groupes',
        isGroup: true,
        groupSize: computeGroupSize(children),
        children,
        placementRule: placementRuleFromId(placementRuleId),
        salons: assignedSalons,
        addedBy: 'Admin Stand-ING',
        format: 'Groupe',
      },
    });
    setSaving(false);
  };

  return (
    <div className="asset-drawer-layer">
      <aside className="asset-drawer asset-group-drawer">
        <header>
          <div>
            <h2>Créer un groupe d'objets</h2>
            <span>Groupe manipulable en un seul bloc</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </header>

        <label className="asset-group-field">
          <span>Nom du groupe</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <section className="asset-group-placement">
          <h3>Règle de placement</h3>
          <label>
            <span>Position obligatoire</span>
            <select value={placementRuleId} onChange={(event) => setPlacementRuleId(event.target.value)}>
              {placementRuleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <small>{placementRuleLabel(placementRuleId, true)}</small>
        </section>

        <section className="asset-group-builder">
          <h3>Objets du groupe</h3>
          <p>Place les objets directement sur le plan en vue du dessus. Les champs X/Z restent disponibles pour l'ajustement précis au centimètre.</p>
          <MiniGroupPlan
            rows={rows}
            sourceAssets={sourceAssets}
            selectedUid={activeRowUid}
            onSelect={setSelectedRowUid}
            onMove={(uid, position) => updateRow(uid, position)}
          />
          {rows.map((row, index) => {
            const selectedSource = sourceAssets.find((asset) => asset.type === row.type);
            return (
              <article key={row.uid} className={`asset-group-row ${activeRowUid === row.uid ? 'active' : ''}`} onClick={() => setSelectedRowUid(row.uid)}>
                <label>
                  <span>Objet</span>
                  <select value={row.type} onChange={(event) => updateRow(row.uid, { type: event.target.value, label: '' })}>
                    {sourceAssets.map((asset) => <option key={asset.type} value={asset.type}>{asset.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Libellé plan</span>
                  <input value={row.label || selectedSource?.label || ''} onChange={(event) => updateRow(row.uid, { label: event.target.value })} />
                </label>
                <label><span>X m</span><input type="number" step={assetGroupPlacementStep} value={row.x} onChange={(event) => updateRow(row.uid, { x: event.target.value })} /></label>
                <label><span>Z m</span><input type="number" step={assetGroupPlacementStep} value={row.z} onChange={(event) => updateRow(row.uid, { z: event.target.value })} /></label>
                <label><span>Rotation</span><input type="number" step="5" value={row.rotation} onChange={(event) => updateRow(row.uid, { rotation: event.target.value })} /></label>
                <button type="button" onClick={() => removeRow(row.uid)} disabled={rows.length <= 1}><Trash2 size={14} /></button>
              </article>
            );
          })}
          <button type="button" className="asset-group-add-row" onClick={() => {
            const uid = `group-row-${Date.now()}`;
            setRows((current) => [...current, { uid, type: fallbackType, x: 0, z: 0, rotation: 0 }]);
            setSelectedRowUid(uid);
          }}>
            <Plus size={14} /> Ajouter un objet au groupe
          </button>
        </section>

        <section className="asset-assignment">
          <h3>Affectation par salon</h3>
          {(getSalonRows(scenes).map((salon) => salon.title).length ? getSalonRows(scenes).map((salon) => salon.title) : ['SMCL 2026']).map((salon) => {
            const active = assignedSalons.includes(salon);
            return (
              <button key={salon} type="button" onClick={() => toggleSalon(salon)}>
                <strong>{salon}</strong>
                <span>{active ? 'Actif' : 'Inactif'}</span>
                <i className={active ? 'active' : ''} />
              </button>
            );
          })}
        </section>

        <footer>
          <button type="button" className="asset-delete" onClick={onClose}>Annuler</button>
          <button type="button" className="asset-save" disabled={saving || !rows.length} onClick={saveGroup}>
            {saving ? 'Création...' : 'Créer le groupe'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

const assetGroupPlacementStep = 0.01;

function MiniGroupPlan({ rows, sourceAssets, selectedUid, onSelect, onMove }) {
  const svgRef = useRef(null);
  const [draggingUid, setDraggingUid] = useState(null);
  const snapStep = assetGroupPlacementStep;
  const planItems = rows.map((row) => {
    const asset = sourceAssets.find((item) => item.type === row.type);
    const [width = 0.6, , depth = 0.6] = assetModelSize(asset || {});
    return {
      ...row,
      asset,
      width,
      depth,
      x: Number(row.x || 0),
      z: Number(row.z || 0),
      rotation: Number(row.rotation || 0),
    };
  });
  const half = Math.max(1.6, ...planItems.flatMap((item) => [
    Math.abs(item.x) + item.width / 2 + 0.35,
    Math.abs(item.z) + item.depth / 2 + 0.35,
  ]));
  const viewSize = half * 2;

  const pointerToPosition = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * viewSize - half;
    const z = ((event.clientY - rect.top) / rect.height) * viewSize - half;
    return {
      x: snapPosition(x, half, snapStep),
      z: snapPosition(z, half, snapStep),
    };
  };

  const moveActive = (event, uid = draggingUid) => {
    if (!uid) return;
    event.preventDefault();
    onMove(uid, pointerToPosition(event));
  };

  return (
    <div className="asset-group-plan-card">
      <div className="asset-group-plan-head">
        <strong>Mini plan du groupe</strong>
        <span>Glisse un bloc pour le placer</span>
      </div>
      <svg
        ref={svgRef}
        className="asset-group-plan"
        viewBox={`${-half} ${-half} ${viewSize} ${viewSize}`}
        onPointerMove={(event) => moveActive(event)}
        onPointerUp={() => setDraggingUid(null)}
        onPointerLeave={() => setDraggingUid(null)}
      >
        <defs>
          <pattern id="asset-group-grid" width="0.25" height="0.25" patternUnits="userSpaceOnUse">
            <path d="M 0.25 0 L 0 0 0 0.25" fill="none" stroke="#dbe2ec" strokeWidth="0.01" />
          </pattern>
        </defs>
        <rect x={-half} y={-half} width={viewSize} height={viewSize} rx="0.08" fill="url(#asset-group-grid)" />
        <line x1={-half} x2={half} y1="0" y2="0" stroke="#94a3b8" strokeWidth="0.018" strokeDasharray="0.08 0.08" />
        <line x1="0" x2="0" y1={-half} y2={half} stroke="#94a3b8" strokeWidth="0.018" strokeDasharray="0.08 0.08" />
        <circle cx="0" cy="0" r="0.05" fill="#1f4378" />
        {planItems.map((item, index) => {
          const active = selectedUid === item.uid;
          return (
            <g
              key={item.uid}
              transform={`translate(${item.x} ${item.z}) rotate(${item.rotation})`}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                onSelect(item.uid);
                setDraggingUid(item.uid);
                moveActive(event, item.uid);
              }}
            >
              <rect
                x={-item.width / 2}
                y={-item.depth / 2}
                width={item.width}
                height={item.depth}
                rx="0.04"
                fill={active ? '#ffcf5a' : '#dfe8ec'}
                stroke={active ? '#1f4378' : '#7f8fa4'}
                strokeWidth={active ? '0.035' : '0.02'}
              />
              <text x="0" y="0.035" textAnchor="middle" fontSize="0.16" fill="#172033" fontWeight="700">{index + 1}</text>
            </g>
          );
        })}
      </svg>
      <div className="asset-group-plan-legend">
        <span>Centre du groupe</span>
        <span>X horizontal · Z vertical</span>
      </div>
    </div>
  );
}

function AdminMondayView({ syncState, runMondaySync }) {
  return (
    <section className="monday-panel modern">
      <h2>Synchronisation Monday</h2>
      <p>Lit les tableaux SMCL Confort/Prestige, cree une scene quand la colonne CONFIGURABLE vaut OUI, puis remplit le lien configurateur dans Monday.</p>
      <button className="sync-button" onClick={runMondaySync} disabled={syncState.loading}>{syncState.loading ? 'Synchronisation...' : 'Synchroniser Monday'}</button>
      {syncState.message && <div className="sync-result success">{syncState.message}</div>}
      {syncState.error && <div className="sync-result error">{syncState.error}</div>}
    </section>
  );
}

function AdminBatView({ scenes, assets = [] }) {
  const rows = scenes.slice(0, 18);
  return (
    <section className="admin-table modern bat-table">
      {rows.length ? rows.map((scene) => {
        const order = scenePurchaseOrder(scene, assets);
        return (
          <article key={scene.id} className="stand-row bat-row">
            <div><strong>{scene.client_name || 'Exposant sans nom'}</strong><span>{scene.project_name || sceneStandNumber(scene, {}, 'Stand')}</span></div>
            <div><span>Salon</span><strong>{normalizeSalonTitle(scene.event_name || scene.salon) || 'A definir'}</strong></div>
            <div><span>Lots AMCO</span><strong>{order.lines.length ? `${order.total.toLocaleString('fr-FR')} € HT` : 'Aucun lot payant'}</strong></div>
            <div><span>Exposant</span><strong>{clientStatusLabel(scene.client_status)}</strong></div>
            <div className="stand-actions">
              <a href={sceneShareUrl(scene)} target="_blank" rel="noreferrer">Voir la scène</a>
              <button type="button" onClick={() => downloadSceneTechnicalPlan(scene, assets)}>Télécharger BAT</button>
              <button type="button" onClick={() => downloadScenePurchaseOrder(scene, assets)}>Bon de commande</button>
            </div>
          </article>
        );
      }) : <div className="admin-empty-row">Aucune scène à afficher.</div>}
    </section>
  );
}

function sceneAdminCatalog(assets = [], scene = {}) {
  const salonLabel = normalizeSalonTitle(scene.event_name || scene.salon);
  const dynamicEntries = (assets || [])
    .filter((asset) => asset.is_active)
    .filter((asset) => !asset.dimensions?.isColorGroup)
    .filter((asset) => assetMatchesSalon(asset, salonLabel))
    .map((asset) => assetToCatalogEntry(asset, assets))
    .filter(Boolean);
  const entries = [...dynamicEntries, ...nativeCatalogEntries()];
  return uniqueCatalogEntries(entries);
}

function sceneAdminItems(scene = {}, catalogEntries = []) {
  return (scene.items || []).map((item) => hydrateSceneItemFromCatalog(item, catalogEntries));
}

function sceneAllAdminItems(scene = {}, catalogEntries = []) {
  const width = Number(scene.dimensions?.width || scene.width_m || 4);
  const depth = Number(scene.dimensions?.depth || scene.depth_m || 3);
  const layout = scene.layout || 'back';
  const area = width * depth;
  const salonLabel = normalizeSalonTitle(scene.event_name || scene.salon);
  const options = scene.options || scene.source_payload?.options || {};
  const manualItems = sceneAdminItems(scene, catalogEntries);
  const reserveRule = activeReserveRule(sceneReserveRules(scene), area);
  const reserveOption = options.reserveOptionType === '__legacy__'
    ? normalizeComplementaryOptions(reserveRule?.options)[0]?.type || ''
    : options.reserveOptionType || '';
  const partitionRule = activePartitionHeadRule(scenePartitionHeadRules(scene), area, layout);
  const partitionSides = partitionHeadEnabledSides(partitionRule, {
    left: hasOwn(options, 'partitionHeadLeftEnabled') ? Boolean(options.partitionHeadLeftEnabled) : null,
    right: hasOwn(options, 'partitionHeadRightEnabled') ? Boolean(options.partitionHeadRightEnabled) : null,
  });
  const ledEntries = ledRailCatalogEntries(catalogEntries);
  const autoSpotsRule = options.autoSpotsRule || null;
  const automaticReserveItems = makeAutomaticReserveItems(reserveRule, reserveOption, catalogEntries, width, depth, layout, salonLabel);
  const ledItems = options.ledRailsEnabled === false
    ? []
    : autoSpotsRule?.type
      ? makeAutomaticSpotItems(autoSpotsRule, catalogEntries, width, depth, layout, [...automaticReserveItems, ...manualItems])
        .map((item) => applyLedRailOverride(item, options.ledRailOverrides || {}, width, depth, layout))
      : makeAutomaticLedRailItems(ledEntries, width, depth, layout, ledSpotCountForArea(area))
        .map((item) => applyLedRailOverride(item, options.ledRailOverrides || {}, width, depth, layout));
  return [
    ...manualItems,
    ...automaticReserveItems,
    ...makeAutomaticPartitionHeadItems(partitionRule, partitionSides, catalogEntries, width, depth, layout, salonLabel),
    ...ledItems,
  ];
}

function scenePurchaseOrder(scene = {}, assets = []) {
  const catalogEntries = sceneAdminCatalog(assets, scene);
  const savedLines = scene?.source_payload?.pricing?.lines || scene?.pricing?.lines || [];
  const fallbackPricing = calculateScenePricing({
    catalog: catalogEntries,
    items: sceneAllAdminItems(scene, catalogEntries),
    salonLabel: normalizeSalonTitle(scene.event_name || scene.salon),
    scene,
  });
  const sourceLines = savedLines.length ? savedLines : fallbackPricing.lines;
  const lines = normalizePurchaseOrderLines(sourceLines, catalogEntries);
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  return { lines, total };
}

function normalizePurchaseOrderLines(lines = [], catalogEntries = []) {
  return (lines || [])
    .map((line) => {
      const entry = findCatalogEntry(catalogEntries, line.type);
      const quantity = Math.max(0, Number(line.quantity || line.qty || 0));
      const total = Math.max(0, Math.round(Number(line.total ?? line.price ?? 0)));
      const unitPrice = Math.max(0, Math.round(Number(line.unitPrice ?? line.unit_price ?? (quantity ? total / quantity : 0))));
      return {
        type: line.type || entry?.type || '',
        reference: line.reference || assetReference(entry, '') || '',
        label: line.label || entry?.label || line.type || 'Lot AMCO',
        quantity,
        unitPrice,
        total: total || unitPrice * quantity,
      };
    })
    .filter((line) => line.quantity > 0 && line.total > 0);
}

function downloadSceneTechnicalPlan(scene = {}, assets = []) {
  const catalogEntries = sceneAdminCatalog(assets, scene);
  const width = Number(scene.dimensions?.width || scene.width_m || 4);
  const depth = Number(scene.dimensions?.depth || scene.depth_m || 3);
  exportTechnicalPng({
    width,
    depth,
    layout: scene.layout || 'back',
    items: sceneAllAdminItems(scene, catalogEntries),
    catalog: catalogEntries,
  });
}

async function downloadScenePurchaseOrder(scene = {}, assets = []) {
  const order = scenePurchaseOrder(scene, assets);
  const fileName = `bon-de-commande-${slugForType(scene.client_name || scene.project_name || scene.id || 'stand')}.pdf`;
  const blob = await fillPurchaseOrderTemplate(order);
  downloadBlob(blob, fileName);
}

async function fillPurchaseOrderTemplate(order = {}) {
  const rows = order.lines?.length ? order.lines : [];
  const response = await fetch('/templates/bon-commande-template.pdf');
  if (!response.ok) throw new Error('Template bon de commande introuvable.');
  const pdfDoc = await PDFDocument.load(await response.arrayBuffer());
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < 15; index += 1) {
    const rowNumber = index + 1;
    const line = rows[index];
    setPdfField(form, `ACC${rowNumber}a`, line ? truncatePdfText(line.reference || line.label, 62) : '');
    setPdfField(form, `Quant${rowNumber}a`, line ? String(line.quantity) : '');
    setPdfField(form, `PU${rowNumber}a`, line ? moneyPdf(line.unitPrice) : '');
    setPdfField(form, `PT${rowNumber}a`, line ? moneyPdf(line.total) : '');
  }

  const totalHt = Number(order.total || 0);
  const totalTva = Math.round(totalHt * 0.2);
  setPdfField(form, 'TOTAL', moneyPdf(totalHt));
  setPdfField(form, 'TVA', moneyPdf(totalTva));
  setPdfField(form, 'TOTAL_TTC', moneyPdf(totalHt + totalTva));
  form.updateFieldAppearances(font);

  return new Blob([await pdfDoc.save()], { type: 'application/pdf' });
}

function setPdfField(form, name, value) {
  try {
    const field = form.getTextField(name);
    field.setText(toPdfWinAnsi(value));
    field.setFontSize(name.startsWith('ACC') ? 8 : 9);
  } catch (error) {
    console.warn('Champ PDF bon de commande introuvable', name, error);
  }
}


function moneyPdf(value) {
  return toPdfWinAnsi(Number(value || 0).toLocaleString('fr-FR'));
}

function toPdfWinAnsi(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[']/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[²]/g, '2')
    .replace(/€/g, 'EUR');
}

function truncatePdfText(text = '', max = 40) {
  const safe = toPdfWinAnsi(text);
  return safe.length > max ? `${safe.slice(0, Math.max(0, max - 1))}.` : safe;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function AdminPlaceholder({ tab }) {
  return (
    <section className="admin-placeholder-card">
      <h2>{adminTitle(tab)}</h2>
      <p>La maquette de ce menu sera intégrée dès que tu me l'envoies.</p>
    </section>
  );
}

function formatNumber(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function sceneArea(scene) {
  const width = Number(scene.dimensions?.width || scene.width_m || 0);
  const depth = Number(scene.dimensions?.depth || scene.depth_m || 0);
  return Math.round(width * depth);
}

function carpetFootprintAreaM2() {
  return 1;
}

function sceneWallFabricArea(width = 0, depth = 0, layout = 'u') {
  const backArea = Number(width || 0) * fixedWallHeight;
  const sideDepth = Math.max(0, Number(depth || 0) - wallThickness);
  const sideCount = (layout === 'left' || layout === 'right') ? 1 : layout === 'u' ? 2 : 0;
  return roundM2(backArea + (sideDepth * fixedWallHeight * sideCount));
}

function roundM2(value = 0) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function openTechnicalFloorEdges(layout = 'u') {
  const edges = ['front'];
  if (layout !== 'left' && layout !== 'u') edges.push('left');
  if (layout !== 'right' && layout !== 'u') edges.push('right');
  return edges;
}

function technicalFloorEdgeLabel(edge = '') {
  if (edge === 'front') return 'devant';
  if (edge === 'left') return 'gauche';
  if (edge === 'right') return 'droite';
  return edge;
}

function technicalTrimLabel(trimType = 'straight') {
  return technicalTrimOptions.find((option) => option.id === trimType)?.label || technicalTrimOptions[0].label;
}

function relativeDays(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.max(0, Math.round(diff / 86400000));
  if (days === 0) return 'auj.';
  return `${days}j`;
}

function relativeTime(value) {
  if (!value) return '—';
  const diffHours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3600000));
  if (diffHours < 1) return "à l'instant";
  if (diffHours < 24) return `il y a ${diffHours}h`;
  const days = Math.round(diffHours / 24);
  if (days === 1) return 'hier';
  return `il y a ${days}j`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR').format(new Date(value));
}

function assetCategoryLabel(asset) {
  if (asset.dimensions?.isColorGroup) return 'Groupes de couleurs';
  if (asset.dimensions?.isVariantGroup) return 'Groupes de variantes';
  if (asset.dimensions?.isGroup) return 'Groupes';
  if (asset.dimensions?.category) return asset.dimensions.category;
  if (asset.type?.includes('screen')) return 'Multimédia';
  if (asset.type?.includes('poster')) return 'Signalétique';
  if (asset.type?.includes('cloison') || asset.type?.includes('porte')) return 'Sol & Cloisons';
  if (asset.type?.includes('enseigne')) return 'Enseignes';
  return 'Mobilier';
}

function assetFormat(asset) {
  if (asset.dimensions?.isColorGroup) return 'Couleurs';
  if (asset.dimensions?.isVariantGroup) return 'Groupe de variantes';
  if (asset.dimensions?.isGroup) return 'Groupe';
  const url = asset.model_url || '';
  const ext = url.split('.').pop()?.toUpperCase();
  if (ext === 'OBJ' || ext === 'GLB') return ext;
  return asset.model_url ? '3D' : 'Natif';
}

function assetSizeLabel(asset) {
  if (asset.dimensions?.isColorGroup) return `${normalizeColorGroupOptions(asset).length} couleurs`;
  if (asset.dimensions?.isVariantGroup) return `${asset.dimensions?.variantAssetTypes?.length || 0} variantes`;
  if (asset.dimensions?.isGroup) return `${asset.dimensions?.children?.length || 0} objets`;
  if (asset.dimensions?.sizeMb) return `${asset.dimensions.sizeMb} Mo`;
  if (asset.dimensions?.fileSizeMb) return `${asset.dimensions.fileSizeMb} Mo`;
  return '—';
}

function assetDimensionsLabel(asset) {
  const size = asset.dimensions?.groupSize || asset.dimensions?.size || asset.dimensions?.dimensions;
  if (!Array.isArray(size)) return '—';
  return size.map((value) => `${Number(value).toLocaleString('fr-FR')} m`).join(' × ');
}

function isVariantGroupEntry(assetOrEntry = {}) {
  return Boolean(assetOrEntry?.dimensions?.isVariantGroup);
}

function groupSourceAssets(assets = []) {
  const baseAssets = nativeCatalogEntries()
    .filter((entry) => !entry.isGroup && !isWallItemType(entry.type))
    .map((entry) => ({
      type: entry.type,
      label: entry.label,
      model_url: entry.modelUrl,
      color: entry.color,
      dimensions: {
        size: entry.modelSize,
        category: assetCategoryLabel({ type: entry.type }),
        materialUrl: entry.materialUrl || null,
      },
    }));
  const dynamicAssets = assets.filter((asset) => asset.is_active && !asset.dimensions?.isColorGroup && !asset.dimensions?.isGroup && !asset.dimensions?.isVariantGroup && !isWallItemType(asset.type));
  const all = [...baseAssets, ...dynamicAssets];
  return all.filter((asset, index) => all.findIndex((candidate) => candidate.type === asset.type) === index);
}

function variantSourceAssets(assets = [], excludedType = '') {
  return assets
    .filter((asset) => asset.type !== excludedType)
    .filter((asset) => asset.is_active)
    .filter((asset) => !asset.dimensions?.isColorGroup)
    .filter((asset) => !asset.dimensions?.isGroup && !asset.dimensions?.isVariantGroup)
    .filter((asset, index, all) => all.findIndex((candidate) => candidate.type === asset.type) === index);
}

function nativeCatalogEntries() {
  return catalog.filter((entry) => !entry.modelUrl && !entry.materialUrl && !entry.isGroup);
}

function uniqueCatalogEntries(entries = []) {
  return (entries || [])
    .filter(Boolean)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate?.type === entry?.type) === index);
}

function assetToGroupRows(asset) {
  return (asset?.dimensions?.children || []).map((child, index) => ({
    uid: `${child.id || child.type || 'child'}-${index}-${Date.now()}`,
    type: child.type,
    label: child.label || '',
    x: Number(child.x || 0),
    z: Number(child.z || 0),
    rotation: Number(child.rotation || 0),
    depthLocked6cm: Boolean(child.dimensions?.depthLocked6cm),
  }));
}

function buildGroupChildren(rows, sourceAssets) {
  return rows
    .map((row, index) => {
      const source = sourceAssets.find((asset) => asset.type === row.type);
      if (!source) return null;
      return {
        id: `${source.type}-child-${index + 1}`,
        type: source.type,
        label: row.label || source.label,
        x: Number(row.x || 0),
        y: 0,
        z: Number(row.z || 0),
        rotation: Number(row.rotation || 0),
        modelUrl: source.model_url,
        modelSize: assetModelSize(source),
        materialUrl: source.dimensions?.materialUrl || null,
        dimensions: { ...(source.dimensions || {}), ...(row.depthLocked6cm ? { depthLocked6cm: true } : { depthLocked6cm: undefined }) },
        color: source.dimensions?.color || source.color,
        lockedInGroup: true,
      };
    })
    .filter(Boolean);
}

function assetSalons(asset, scenes = []) {
  if (Array.isArray(asset.dimensions?.salons)) return asset.dimensions.salons;
  const salons = [...new Set(scenes.map((scene) => normalizeSalonTitle(scene.event_name || scene.salon)).filter(Boolean))];
  return asset.is_active ? salons.slice(0, 1) : [];
}

function colorGroupAssets(assets = [], salonLabel = '', usage = '') {
  return (assets || [])
    .filter((asset) => asset?.dimensions?.isColorGroup)
    .filter((asset) => asset.is_active !== false)
    .filter((asset) => colorGroupMatchesSalon(asset, salonLabel))
    .filter((asset) => colorGroupUsages(asset).includes(usage));
}

function colorGroupConfigOptions(assets = [], salonLabel = '', usage = '') {
  const group = colorGroupAssets(assets, salonLabel, usage)[0];
  return normalizeAssetConfigOptions(group?.dimensions?.configOptions || []);
}

function colorOptionsForUsage(assets = [], salonLabel = '', usage = '', fallbackColors = []) {
  const groups = colorGroupAssets(assets, salonLabel, usage);
  if (!groups.length) return fallbackColors;
  return groups.flatMap((group) => {
    const price = Number(group.dimensions?.colorGroupPrice || 0);
    const reference = group.dimensions?.colorGroupReference || '';
    return normalizeColorGroupOptions(group).map((color) => ({
      ...color,
      id: `${group.type}:${color.id}`,
      groupId: group.type,
      groupLabel: group.label,
      price,
      reference,
      isDefault: Boolean(color.isDefault),
      isFree: Boolean(color.isFree),
      included: Boolean(color.included || color.isFree || color.isDefault),
    }));
  });
}

function colorWithDefaultIncluded(color = {}, defaultColorId = '') {
  if (!defaultColorId || normalizeColorId(color.id) !== normalizeColorId(defaultColorId)) return color;
  return { ...color, included: true, defaultIncluded: true };
}

function defaultColorFromPalette(colors = []) {
  return colors.find((color) => color.isDefault)
    || colors.find((color) => color.defaultIncluded)
    || colors.find((color) => color.included)
    || colors[0]
    || null;
}

function findColorInPalette(colors = [], value = '') {
  const normalizedValue = normalizeColorId(value);
  if (!normalizedValue) return null;
  return colors.find((color) => normalizeColorId(color.id) === normalizedValue)
    || colors.find((color) => normalizeColorId(color.code) === normalizedValue)
    || null;
}

function makePaletteDefaultColorOptions({ carpetPalette = [], footprintPalette = [], wallFabricPalette = [] }) {
  const carpetColor = defaultColorFromPalette(carpetPalette);
  const carpetFootprintColor = defaultColorFromPalette(footprintPalette) || carpetColor;
  const wallFabricColor = defaultColorFromPalette(wallFabricPalette);
  return defaultColorOptionsFromColors({ carpetColor, carpetFootprintColor, wallFabricColor, reserveWallFabricColor: wallFabricColor });
}

function defaultColorOptionsFromColors({ carpetColor = null, carpetFootprintColor = null, wallFabricColor = null, reserveWallFabricColor = null }) {
  const reserveColor = reserveWallFabricColor || wallFabricColor;
  return {
    carpetColorId: carpetColor?.id || '',
    carpetColorName: carpetColor?.name || '',
    carpetColorHex: carpetColor?.hex || '',
    carpetColorPrice: Number(carpetColor?.price || 0),
    carpetColorReference: carpetColor?.reference || '',
    carpetFootprintColorId: carpetFootprintColor?.id || carpetColor?.id || '',
    carpetFootprintColorName: carpetFootprintColor?.name || carpetColor?.name || '',
    carpetFootprintColorHex: carpetFootprintColor?.hex || carpetColor?.hex || '',
    carpetFootprintColorPrice: Number(carpetFootprintColor?.price || 0),
    carpetFootprintColorReference: carpetFootprintColor?.reference || '',
    wallFabricColorId: wallFabricColor?.id || '',
    wallFabricColorName: wallFabricColor?.name || '',
    wallFabricColorHex: wallFabricColor?.hex || '',
    wallFabricColorPrice: Number(wallFabricColor?.price || 0),
    wallFabricColorReference: wallFabricColor?.reference || '',
    reserveWallFabricColorId: reserveColor?.id || wallFabricColor?.id || '',
    reserveWallFabricColorName: reserveColor?.name || wallFabricColor?.name || '',
    reserveWallFabricColorHex: reserveColor?.hex || wallFabricColor?.hex || '',
    reserveWallFabricColorPrice: Number(reserveColor?.price || wallFabricColor?.price || 0),
    reserveWallFabricColorReference: reserveColor?.reference || wallFabricColor?.reference || '',
  };
}

function defaultColorOptionsFromFlatOptions(options = {}) {
  const hasDefaults = ['carpetColorId', 'carpetFootprintColorId', 'wallFabricColorId', 'reserveWallFabricColorId'].some((key) => options?.[key]);
  if (!hasDefaults) return {};
  return {
    carpetColorId: options.carpetColorId || '',
    carpetColorName: options.carpetColorName || '',
    carpetColorHex: options.carpetColorHex || '',
    carpetColorPrice: Number(options.carpetColorPrice || 0),
    carpetColorReference: options.carpetColorReference || '',
    carpetFootprintColorId: options.carpetFootprintColorId || options.carpetColorId || '',
    carpetFootprintColorName: options.carpetFootprintColorName || options.carpetColorName || '',
    carpetFootprintColorHex: options.carpetFootprintColorHex || options.carpetColorHex || '',
    carpetFootprintColorPrice: Number(options.carpetFootprintColorPrice || 0),
    carpetFootprintColorReference: options.carpetFootprintColorReference || '',
    wallFabricColorId: options.wallFabricColorId || '',
    wallFabricColorName: options.wallFabricColorName || '',
    wallFabricColorHex: options.wallFabricColorHex || '',
    wallFabricColorPrice: Number(options.wallFabricColorPrice || 0),
    wallFabricColorReference: options.wallFabricColorReference || '',
    reserveWallFabricColorId: options.reserveWallFabricColorId || options.wallFabricColorId || '',
    reserveWallFabricColorName: options.reserveWallFabricColorName || options.wallFabricColorName || '',
    reserveWallFabricColorHex: options.reserveWallFabricColorHex || options.wallFabricColorHex || '',
    reserveWallFabricColorPrice: Number(options.reserveWallFabricColorPrice || options.wallFabricColorPrice || 0),
    reserveWallFabricColorReference: options.reserveWallFabricColorReference || options.wallFabricColorReference || '',
  };
}

function normalizeColorGroupOptions(asset = {}) {
  return (asset.dimensions?.colorOptions || [])
    .map((color, index) => {
      const isDefault = Boolean(color.isDefault || color.defaultIncluded);
      const isFree = Boolean(color.isFree);
      return {
        id: color.id || slugForType(`${color.code || index}-${color.name || 'couleur'}`),
        code: color.code || color.id || String(index + 1),
        name: color.name || color.code || `Couleur ${index + 1}`,
        hex: color.hex || '#b8b8b8',
        image: color.image || '',
        storagePath: color.storagePath || '',
        isDefault,
        isFree,
        included: Boolean(isDefault || isFree),
      };
    });
}

function colorGroupUsages(asset = {}) {
  return Array.isArray(asset.dimensions?.colorUsages) ? asset.dimensions.colorUsages : [];
}

function colorGroupMatchesSalon(asset = {}, salonLabel = '') {
  const salons = assetSalons(asset);
  if (!salons.length) return false;
  return salons.some((salon) => sameSalonLabel(salon, salonLabel));
}

function sameSalonLabel(a = '', b = '') {
  const left = normalizeTextValue(a).replace(/\s+/g, ' ');
  const right = normalizeTextValue(b).replace(/\s+/g, ' ');
  return left === right || left.includes(right) || right.includes(left);
}

function assetToCatalogEntry(asset, allAssets = []) {
  if (asset.dimensions?.isColorGroup) return null;
  if (asset.dimensions?.isVariantGroup) {
    const variantAssets = (asset.dimensions?.variantAssetTypes || [])
      .map((type) => allAssets.find((candidate) => candidate.type === type))
      .filter(Boolean)
      .map((candidate) => assetToCatalogEntry(candidate, allAssets))
      .filter(Boolean);
    const variantOptionLinks = (asset.dimensions?.variantOptionLinks || [])
      .map((link) => {
        const linkedAsset = allAssets.find((candidate) => candidate.type === link.linkedType);
        const linkedEntry = linkedAsset ? assetToCatalogEntry(linkedAsset, allAssets) : null;
        return { ...link, linkedEntry };
      })
      .filter((link) => link.linkedEntry);
    const configOptions = (asset.dimensions?.configOptions || []).map((opt) => {
      if (opt.type !== 'select' || !opt.choices?.length) return opt;
      return {
        ...opt,
        choices: opt.choices.map((choice) => {
          const choiceAsset = allAssets.find((candidate) => candidate.type === choice.assetType);
          return { ...choice, entry: choiceAsset ? assetToCatalogEntry(choiceAsset, allAssets) : null };
        }),
      };
    });
    const allEntryPrices = [
      ...variantAssets.map((entry) => assetUnitPrice(entry, assetSalons(asset)[0])),
      ...configOptions.filter((o) => o.type === 'select').flatMap((o) => (o.choices || []).map((c) => c.entry ? assetUnitPrice(c.entry, assetSalons(asset)[0]) : 0)),
    ].filter((price) => price > 0);
    return {
      type: asset.type,
      label: asset.label,
      icon: Layers,
      color: asset.dimensions?.color || '#dfe8ec',
      price: Math.min(...allEntryPrices, 0) || 0,
      thumbnailUrl: asset.thumbnail_url,
      dimensions: {
        ...(asset.dimensions || {}),
        isVariantGroup: true,
        variantAssets,
        variantOptionLinks,
        configOptions,
      },
    };
  }

  if (asset.dimensions?.isGroup) {
    return {
      type: asset.type,
      label: asset.label,
      icon: Layers,
      color: asset.dimensions?.color || '#dfe8ec',
      isGroup: true,
      groupSize: asset.dimensions?.groupSize || computeGroupSize(asset.dimensions?.children || []),
      children: asset.dimensions?.children || [],
      placementRule: effectivePlacementRule(asset),
      movementLocked: Boolean(asset.dimensions?.movementLocked),
      deleteLocked: Boolean(asset.dimensions?.deleteLocked),
      rotationLocked: Boolean(asset.dimensions?.rotationLocked),
      price: asset.dimensions?.price || 0,
      thumbnailUrl: asset.thumbnail_url,
      dimensions: asset.dimensions || {},
    };
  }

  return {
    type: asset.type,
    label: asset.label,
    icon: Box,
    color: asset.dimensions?.color || '#efece2',
    modelUrl: asset.model_url,
    modelSize: assetModelSize(asset),
    materialUrl: asset.dimensions?.materialUrl || null,
    price: asset.dimensions?.price || 0,
    thumbnailUrl: asset.thumbnail_url,
    isWallItem: assetPlacementMode(asset) === 'wall',
    collisionEnabled: asset.dimensions?.collisionEnabled !== false,
    placementRule: effectivePlacementRule(asset),
    movementLocked: Boolean(asset.dimensions?.movementLocked),
    deleteLocked: Boolean(asset.dimensions?.deleteLocked),
    rotationLocked: Boolean(asset.dimensions?.rotationLocked),
    dimensions: asset.dimensions || {},
  };
}

function assetModelSize(asset) {
  const size = asset.dimensions?.size || asset.dimensions?.dimensions || asset.dimensions?.modelSize;
  if (asset.dimensions?.sizeSource === 'manual' && Array.isArray(size) && size.length >= 3) return normalizeModelSize(size);
  if (Array.isArray(size) && size.length >= 3) return normalizeModelSize(size);
  return inferredAssetModelSize(asset);
}


function normalizeModelSize(size, fallback = [0.55, 0.7, 0.55]) {
  return fallback.map((fallbackValue, index) => {
    const value = Number(size?.[index]);
    return Number((Number.isFinite(value) && value > 0 ? value : fallbackValue).toFixed(2));
  });
}

function inferredAssetModelSize(asset = {}) {
  const label = `${asset.type || ''} ${asset.label || ''}`.toLowerCase();
  if (/poubelle|corbeille|trash|bin/.test(label)) return [0.28, 0.45, 0.28];
  if (/porte(?![-\s]*doc)|door/.test(label)) return [0.9, fixedWallHeight, 0.08];
  if (/cloison|wall|partition/.test(label)) return [1, fixedWallHeight, wallThickness];
  if (/tabouret/.test(label)) return [0.52, 0.86, 0.5];
  if (/chaise|chair/.test(label)) return [0.52, 0.86, 0.5];
  if (/table|mange/.test(label)) return [0.8, 0.75, 0.8];
  if (/comptoir|counter/.test(label)) return [1.15, 1.01, 0.5];
  return [0.55, 0.7, 0.55];
}

function computeGroupSize(children = []) {
  if (!children.length) return [1, 1, 1];
  const bounds = children.reduce((acc, child) => {
    const size = child.modelSize?.length >= 3 ? child.modelSize : [0.6, 0.6, 0.6];
    const width = Number(size[0]) || 0.6;
    const height = Number(size[1]) || 0.6;
    const depth = Number(size[2]) || 0.6;
    return {
      minX: Math.min(acc.minX, Number(child.x || 0) - width / 2),
      maxX: Math.max(acc.maxX, Number(child.x || 0) + width / 2),
      minZ: Math.min(acc.minZ, Number(child.z || 0) - depth / 2),
      maxZ: Math.max(acc.maxZ, Number(child.z || 0) + depth / 2),
      height: Math.max(acc.height, height),
    };
  }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0.6 });
  return [
    Number(Math.max(0.4, bounds.maxX - bounds.minX).toFixed(2)),
    Number(Math.max(0.4, bounds.height).toFixed(2)),
    Number(Math.max(0.4, bounds.maxZ - bounds.minZ).toFixed(2)),
  ];
}

function slugForType(value) {
  return String(value || 'groupe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'groupe';
}

function snapPosition(value, limit, step = 0.1) {
  const snapped = Math.round(value / step) * step;
  return Number(clamp(snapped, -limit, limit).toFixed(2));
}

function assetMatchesSalon(asset, salonLabel = '') {
  const salons = assetSalons(asset);
  if (!salons.length) return true;
  const currentSalon = normalizeSalonLabel(salonLabel);
  if (!currentSalon) return true;
  return salons.some((salon) => {
    const assignedSalon = normalizeSalonLabel(salon);
    return assignedSalon && (currentSalon.includes(assignedSalon) || assignedSalon.includes(currentSalon));
  });
}

function normalizeSalonLabel(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(salon|stand|paris|le|bourget)\b/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function assetStatus(asset) {
  if (!asset.is_active) return 'inactive';
  if (asset.dimensions?.processing) return 'processing';
  return 'active';
}

function isIncludedSceneItem(item) {
  return Boolean(item?.included || item?.priceMode === 'included' || item?.price_mode === 'included' || item?.basePresetId);
}

function isFurniturePanelType(item) {
  if (!item || isWallItem(item)) return false;
  const label = `${item.label || ''} ${item.type || ''}`.toLowerCase();
  if (label.includes('cloison') || label.includes('porte poussant')) return false;
  return true;
}

function sceneBaseItems(scene) {
  const baseItems = scene?.source_payload?.baseItems
    || scene?.source_payload?.base_items
    || scene?.source_payload?.pricing?.baseItems
    || scene?.metadata?.baseItems
    || [];
  return normalizeBaseItemsForUi(baseItems);
}

function sceneHasBaseItems(scene) {
  return Boolean(
    scene?.source_payload
    && (
      Object.prototype.hasOwnProperty.call(scene.source_payload, 'baseItems')
      || Object.prototype.hasOwnProperty.call(scene.source_payload, 'base_items')
      || Object.prototype.hasOwnProperty.call(scene.source_payload?.pricing || {}, 'baseItems')
    )
  );
}

function normalizeBaseItemsForUi(baseItems = []) {
  return (baseItems || [])
    .map((item) => ({
      type: item.type,
      label: item.label || catalog.find((entry) => entry.type === item.type)?.label || item.type,
      quantity: Math.max(0, Number(item.quantity || 0)),
    }))
    .filter((item) => item.type && item.quantity > 0);
}

function baseItemsToCountMap(baseItems = []) {
  return normalizeBaseItemsForUi(baseItems).reduce((counts, item) => {
    counts.set(item.type, (counts.get(item.type) || 0) + item.quantity);
    return counts;
  }, new Map());
}

function baseItemsToQuantityMap(baseItems = []) {
  return normalizeBaseItemsForUi(baseItems).reduce((acc, item) => {
    acc[item.type] = item.quantity;
    return acc;
  }, {});
}

function isBasePackEligible(entry) {
  if (isVariantGroupEntry(entry)) return false;
  const category = furniturePanelCategory(entry);
  return category === 'furniture' || category === 'multimedia';
}

function sceneReserveRules(scene = {}) {
  return normalizeReserveRules(
    scene?.source_payload?.reserveRules
    || scene?.source_payload?.reserve_rules
    || scene?.source_payload?.pricing?.reserveRules
    || scene?.options?.reserveRules
    || scene?.source_payload?.options?.reserveRules
    || {},
  );
}

function normalizeReserveRules(rules = {}, config = {}) {
  const keepEmptyOptions = Boolean(config.keepEmptyOptions);
  return reserveRuleBands.reduce((acc, band) => {
    const source = rules?.[band.id] || {};
    const legacyOption = source.upgradeType || source.upgrade_type
      ? [{ type: source.upgradeType || source.upgrade_type, label: source.upgradeLabel || source.upgrade_label || '', price: source.upgradePrice ?? source.upgrade_price ?? '' }]
      : [];
    acc[band.id] = {
      id: band.id,
      bandLabel: band.label,
      minArea: band.minArea,
      maxArea: band.maxArea,
      includedType: source.includedType || source.included_type || '',
      includedLabel: source.includedLabel || source.included_label || band.includedLabel,
      options: normalizeComplementaryOptions(source.options || source.complementaryOptions || source.complementary_options || legacyOption, { keepEmpty: keepEmptyOptions }),
    };
    return acc;
  }, {});
}

function activeReserveRule(rules = {}, area = 0) {
  const numericArea = Number(area || 0);
  const band = reserveRuleBands.find((entry) => (
    numericArea >= entry.minArea
    && (entry.maxArea === null || numericArea <= entry.maxArea)
  ));
  return band ? normalizeReserveRules(rules)[band.id] : null;
}

function normalizeComplementaryOptions(options = [], config = {}) {
  const keepEmpty = Boolean(config.keepEmpty);
  return (options || [])
    .map((option) => ({
      type: option.type || option.assetType || option.asset_type || '',
      label: option.label || option.name || '',
      price: option.price ?? option.upgradePrice ?? option.upgrade_price ?? '',
    }))
    .filter((option) => keepEmpty || option.type || option.label || option.price !== '');
}

function reserveOptionPrice(option = {}, entry = null, salonLabel = '') {
  return firstPriceValue(option.price, assetUnitPrice(entry, salonLabel), 0);
}

function isReserveCatalogEntry(entry = {}) {
  const text = `${entry.type || ''} ${entry.label || ''} ${entry.dimensions?.category || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return Boolean(entry.dimensions?.isReserve || text.includes('reserve'));
}

function makeAutomaticReserveItems(rule, selectedOptionType, catalogEntries = [], width, depth, layout, salonLabel) {
  if (selectedOptionType === '__none__') return [];
  if (!rule?.includedType && !selectedOptionType) return [];
  const selectedOption = normalizeComplementaryOptions(rule?.options).find((option) => option.type === selectedOptionType) || null;
  const type = selectedOption?.type || rule?.includedType;
  const entry = findCatalogEntry(catalogEntries, type);
  if (!entry) return [];

  const billable = Boolean(selectedOption);
  const unitPrice = billable ? reserveOptionPrice(selectedOption, entry, salonLabel) : 0;
  const base = makeItem(type, width, depth, layout, entry);
  const item = constrainItem({
    ...base,
    id: `auto-reserve-${rule.id}`,
    label: billable
      ? (selectedOption.label || entry.label || 'Réserve complémentaire')
      : (rule.includedLabel || entry.label || 'Réserve incluse'),
    autoReserve: true,
    included: !billable,
    priceMode: billable ? 'billable' : 'included',
    movementLocked: Boolean(base.movementLocked || entry?.movementLocked || entry?.dimensions?.movementLocked),
    deleteLocked: true,
    rotationLocked: true,
    options: {
      ...(base.options || {}),
      unitPrice,
      reserveRuleId: rule.id,
      reserveUpgrade: billable,
      reserveOptionType: selectedOption?.type || '',
    },
  }, width, depth, layout);

  return [item];
}

function scenePartitionHeadRules(scene = {}) {
  return normalizePartitionHeadRules(
    scene?.source_payload?.partitionHeadRules
    || scene?.source_payload?.partition_head_rules
    || scene?.source_payload?.pricing?.partitionHeadRules
    || scene?.options?.partitionHeadRules
    || scene?.source_payload?.options?.partitionHeadRules
    || {},
  );
}

function normalizePartitionHeadRules(rules = {}) {
  return partitionHeadRuleBands.reduce((acc, band) => {
    const source = rules?.[band.id] || {};
    acc[band.id] = {
      id: band.id,
      bandLabel: band.label,
      minArea: band.minArea,
      maxArea: band.maxArea,
      includedCount: Number(source.includedCount ?? source.included_count ?? band.includedCount),
      includedSides: normalizePartitionHeadIncludedSides(source.includedSides || source.included_sides, source.includedSide || source.included_side),
      leftType: source.leftType || source.left_type || '',
      leftLabel: source.leftLabel || source.left_label || 'Tête de cloison gauche',
      leftPrice: source.leftPrice ?? source.left_price ?? '',
      rightType: source.rightType || source.right_type || '',
      rightLabel: source.rightLabel || source.right_label || 'Tête de cloison droite',
      rightPrice: source.rightPrice ?? source.right_price ?? '',
    };
    return acc;
  }, {});
}

function normalizePartitionHeadIncludedSides(sides, side = '') {
  const values = Array.isArray(sides) ? sides : (side ? [side] : []);
  return values.filter((value) => value === 'left' || value === 'right');
}

function activePartitionHeadRule(rules = {}, area = 0, layout = 'u') {
  const numericArea = Number(area || 0);
  const band = partitionHeadRuleBands.find((entry) => (
    numericArea >= entry.minArea
    && (entry.maxArea === null || numericArea <= entry.maxArea)
  ));
  if (!band) return null;
  const rule = normalizePartitionHeadRules(rules)[band.id];
  const includedSides = partitionHeadRuleIncludedSides(rule, layout);
  return { ...rule, includedSides };
}

function partitionHeadRuleIncludedSides(rule = {}, layout = 'u') {
  const count = Number(rule.includedCount || 0);
  if (count <= 0) return [];
  if (count >= 2) return ['left', 'right'];
  return rule.includedSides?.length ? rule.includedSides.slice(0, 1) : defaultIncludedPartitionHeadSides(count, layout);
}

function defaultIncludedPartitionHeadSides(includedCount = 0, layout = 'u') {
  const count = Number(includedCount || 0);
  if (count <= 0) return [];
  if (count >= 2) return ['left', 'right'];
  return [layout === 'right' ? 'right' : 'left'];
}

function partitionHeadEnabledSides(rule, choice = {}) {
  if (!rule) return { left: false, right: false };
  return {
    left: choice.left === null || choice.left === undefined ? rule.includedSides?.includes('left') : Boolean(choice.left),
    right: choice.right === null || choice.right === undefined ? rule.includedSides?.includes('right') : Boolean(choice.right),
  };
}

function partitionHeadSelectedSides(rule = {}, sides = {}) {
  return [
    ...(rule.includedSides || []).filter((side) => sides?.[side]),
    ...['left', 'right'].filter((side) => sides?.[side] && !(rule.includedSides || []).includes(side)),
  ];
}

function partitionHeadBillableSides(rule = {}, sides = {}) {
  const selectedSides = partitionHeadSelectedSides(rule, sides);
  const includedCount = Math.max(0, Number(rule?.includedCount || 0));
  return new Set(selectedSides.slice(includedCount));
}

function makeAutomaticPartitionHeadItems(rule, sides = {}, catalogEntries = [], width, depth, layout, salonLabel) {
  if (!rule) return [];
  const selectedSides = partitionHeadSelectedSides(rule, sides);
  const billableSides = partitionHeadBillableSides(rule, sides);
  return selectedSides.map((side) => {
    const type = side === 'left' ? rule.leftType : rule.rightType;
    const entry = findCatalogEntry(catalogEntries, type);
    if (!entry) return null;
    const billable = billableSides.has(side);
    const price = side === 'left' ? rule.leftPrice : rule.rightPrice;
    const unitPrice = billable ? firstPriceValue(price, assetUnitPrice(entry, salonLabel), 0) : 0;
    const base = makeItem(type, width, depth, layout, entry);
    return constrainItem({
      ...base,
      id: `auto-partition-head-${rule.id}-${side}`,
      label: side === 'left' ? (rule.leftLabel || entry.label) : (rule.rightLabel || entry.label),
      autoPartitionHead: true,
      included: !billable,
      priceMode: billable ? 'billable' : 'included',
      movementLocked: true,
      deleteLocked: true,
      rotationLocked: true,
      options: {
        ...(base.options || {}),
        unitPrice,
        partitionHeadRuleId: rule.id,
        partitionHeadSide: side,
      },
    }, width, depth, layout);
  }).filter(Boolean);
}

function isAutomaticPartitionHeadItem(item = {}) {
  return Boolean(item?.autoPartitionHead || item?.dimensions?.autoPartitionHead);
}

function applyPartitionHeadVisualOptions(item = {}, visuals = {}) {
  const side = item.options?.partitionHeadSide || item.dimensions?.smclHeadSide || smclPartitionHeadSide(item);
  const visual = side ? visuals?.[side] : null;
  if (!visual) return item;
  return {
    ...item,
    options: {
      ...(item.options || {}),
      ...visual,
    },
  };
}

function partitionHeadSummary(rule, sides = {}) {
  if (!rule) return 'Non configurées';
  const labels = [];
  if (sides.left) labels.push('gauche');
  if (sides.right) labels.push('droite');
  return labels.length ? labels.join(' + ') : 'Aucune';
}

function calculateScenePricing({ catalog, items, salonLabel, scene, colorSelections = [], technicalFloor = null, wallCovers = {}, wallCoverSurfaces = [] }) {
  const basePrice = 0;
  const baseItems = sceneBaseItems(scene);
  const baseItemsConfigured = sceneHasBaseItems(scene);
  const includedSceneCounts = countSceneItems(items.filter(isIncludedSceneItem));
  const baseItemCounts = baseItemsToCountMap(baseItems);
  const includedCounts = baseItemsConfigured
    ? mergeIncludedCountMaps(includedSceneCounts, baseItemCounts)
    : includedSceneCounts;
  items.filter(isIncludedSceneItem).forEach((item) => {
    const baseType = item.options?.includedBaseType;
    if (baseType && baseType !== item.type) {
      includedCounts.set(baseType, Math.max(0, (includedCounts.get(baseType) || 0) - 1));
    }
  });
  const totalCounts = countSceneItems(items);
  const baseUsage = baseItemsConfigured
    ? baseItems.map((item) => {
      const quantity = Number(item.quantity || 0);
      const used = Math.min(totalCounts.get(item.type) || 0, quantity);
      return {
        ...item,
        quantity,
        used,
        remaining: Math.max(0, quantity - used),
        billable: Math.max(0, (totalCounts.get(item.type) || 0) - quantity),
      };
    })
    : [];
  const billableCounts = new Map();
  const lines = [];
  let itemsTotal = 0;

  totalCounts.forEach((totalCount, type) => {
    const includedCount = includedCounts.get(type) || 0;
    const billableCount = Math.max(0, totalCount - includedCount);
    if (!billableCount) {
      billableCounts.set(type, 0);
      return;
    }
    const entry = findCatalogEntry(catalog, type);
    const typeItems = items.filter((item) => item.type === type);
    const billableItems = typeItems.slice(includedCount);
    const itemPrices = billableItems.map((item) => cartItemBasePrice(item, entry, salonLabel));
    const lineTotal = itemPrices.reduce((sum, price) => sum + price, 0);
    const unitPrice = billableCount ? Math.round(lineTotal / billableCount) : assetUnitPrice(entry, salonLabel);
    billableCounts.set(type, billableCount);
    itemsTotal += lineTotal;
    lines.push({
      type,
      label: entry?.label || type,
      quantity: billableCount,
      unitPrice,
      total: lineTotal,
      reference: assetReference(entry, salonLabel),
    });
  });

  items.forEach((item, index) => {
    const entry = findCatalogEntry(catalog, item.type) || item;
    const sizeLine = counterVariantUpgradeOptionLine(item, entry, salonLabel, index);
    if (sizeLine) {
      itemsTotal += sizeLine.total;
      lines.push(sizeLine);
    }
    const colorLine = counterColorOptionLine(item, entry, salonLabel, index);
    if (colorLine) {
      itemsTotal += colorLine.total;
      lines.push(colorLine);
    }
  });

  colorSelections
    .filter((selection) => selection?.color && Number(selection.color.price || 0) > 0)
    .filter((selection) => !isIncludedColorSelection(selection))
    .forEach((selection) => {
      const colorPrice = Number(selection.color.price || 0);
      const quantityM2 = Math.max(0, Number(selection.quantityM2 || 1));
      const lineTotal = Math.round(colorPrice * quantityM2);
      const line = {
        type: `color-${selection.color.groupId || selection.color.id}`,
        label: `${selection.usage} — ${selection.color.groupLabel || selection.color.name} (${formatNumber(quantityM2)} m²)`,
        quantity: quantityM2,
        unitPrice: colorPrice,
        total: lineTotal,
        reference: selection.color.reference || selection.color.code || '',
      };
      itemsTotal += line.total;
      lines.push(line);
    });

  colorSelections
    .filter((selection) => selection?.configOptions?.length && selection?.selectedConfigOptions)
    .forEach((selection) => {
      (selection.configOptions || []).forEach((option) => {
        if (!selection.selectedConfigOptions[option.id]) return;
        const pricePerM2 = Number(option.pricePerM2 || 0);
        const flatPrice = Number(option.price || 0);
        if (pricePerM2 <= 0 && flatPrice <= 0) return;
        const lineTotal = pricePerM2 > 0
          ? Math.round(pricePerM2 * Number(selection.quantityM2 || 1))
          : Math.round(flatPrice);
        itemsTotal += lineTotal;
        lines.push({
          type: `color-option-${selection.color?.groupId || selection.usage}-${option.id}`,
          label: `${selection.usage} — ${option.label}`,
          quantity: pricePerM2 > 0 ? Number(selection.quantityM2 || 1) : 1,
          unitPrice: pricePerM2 > 0 ? pricePerM2 : flatPrice,
          total: lineTotal,
          reference: '',
        });
      });
    });

  if (technicalFloor?.id && Number(technicalFloor.price || 0) > 0) {
    const quantityM2 = Math.max(0, Number(technicalFloor.area || 0));
    const unitPrice = Number(technicalFloor.price || 0);
    const lineTotal = Math.round(quantityM2 * unitPrice);
    itemsTotal += lineTotal;
    lines.push({
      type: `technical-floor-${technicalFloor.id}`,
      label: `${technicalFloor.label} (${formatNumber(quantityM2)} m²)`,
      quantity: quantityM2,
      unitPrice,
      total: lineTotal,
      reference: technicalFloor.reference || '',
    });
  }

  const activeWallCovers = wallCoverSurfaces.filter((surface) => wallCovers?.[surface.id]?.enabled);
  if (activeWallCovers.length) {
    const unitPrice = 245;
    const quantity = activeWallCovers.reduce((sum, surface) => sum + Number(surface.visibleWidth || surface.width || 0), 0);
    const lineTotal = Math.round(quantity * unitPrice);
    itemsTotal += lineTotal;
    lines.push({
      type: 'wall-cover',
      label: `Bâche sur cloisons (${formatNumber(quantity)} ml)`,
      quantity,
      unitPrice,
      total: lineTotal,
      reference: 'BACHE-CLOISON',
    });
  }

  return {
    basePrice,
    baseItems,
    baseUsage,
    baseItemsConfigured,
    billableCounts,
    includedCounts,
    itemsTotal,
    lines,
    total: Math.round(basePrice + itemsTotal),
  };
}

function isIncludedColorSelection(selection = {}) {
  if (selection.color?.included || selection.color?.isFree || selection.color?.isDefault || selection.color?.defaultIncluded) return true;
  if (!selection.defaultColorId || !selection.color?.id) return false;
  return normalizeColorId(selection.defaultColorId) === normalizeColorId(selection.color.id);
}

function normalizeColorId(value = '') {
  return String(value || '').trim().toLowerCase();
}

function mergeIncludedCountMaps(...maps) {
  const merged = new Map();
  maps.forEach((map) => {
    map.forEach((count, type) => {
      merged.set(type, Math.max(merged.get(type) || 0, count || 0));
    });
  });
  return merged;
}

function findCatalogEntry(catalogEntries, type) {
  return (catalogEntries || []).find((entry) => entry.type === type) || catalog.find((entry) => entry.type === type) || null;
}

function hydrateSceneItemFromCatalog(item, catalogEntries = []) {
  const entry = findCatalogEntry(catalogEntries, item?.type);
  if (!entry) return item;
  const isGroup = Boolean(item.isGroup || entry.isGroup);
  const entryDimensions = entry.dimensions || {};
  const itemDimensions = item.dimensions || {};
  const dimensions = {
    ...entryDimensions,
    ...itemDimensions,
    materialUrl: entry.materialUrl || entryDimensions.materialUrl || item.materialUrl || itemDimensions.materialUrl,
    storageRoot: entryDimensions.storageRoot || itemDimensions.storageRoot,
    storagePath: entryDimensions.storagePath || itemDimensions.storagePath,
    materialPath: entryDimensions.materialPath || itemDimensions.materialPath,
    storagePaths: entryDimensions.storagePaths || itemDimensions.storagePaths,
    folderName: entryDimensions.folderName || itemDimensions.folderName,
    size: entryDimensions.size || itemDimensions.size,
    dimensions: entryDimensions.dimensions || itemDimensions.dimensions,
    modelSize: entryDimensions.modelSize || itemDimensions.modelSize,
    sizeSource: entryDimensions.sizeSource || itemDimensions.sizeSource,
  };
  if (isTelevisionItem({ ...item, dimensions }) || isTelevisionItem(entry)) {
    dimensions.isTelevision = true;
    dimensions.mountType = 'wall';
    dimensions.wallY = screenCenterHeight;
  }
  if (isLedRailEntry({ ...item, dimensions }) || isLedRailEntry(entry)) {
    dimensions.isLedSpotOption = true;
    dimensions.mountType = 'wall';
    dimensions.wallY = ledRailCenterY({ ...entry, dimensions });
  }
  const placementRule = hasOwn(item, 'placementRule')
    ? normalizePlacementRule(item.placementRule)
    : effectivePlacementRule(entry);
  const materialUrl = entry.materialUrl || entryDimensions.materialUrl || item.materialUrl || itemDimensions.materialUrl;
  const hydrated = {
    ...item,
    label: item.label || entry.label,
    isGroup,
    groupSize: item.groupSize || entry.groupSize,
    placementRule,
    lockedPlacement: item.lockedPlacement ?? isLockedPlacementRule(placementRule),
    movementLocked: item.movementLocked ?? entry.movementLocked ?? entry.dimensions?.movementLocked,
    deleteLocked: item.deleteLocked ?? entry.deleteLocked ?? entry.dimensions?.deleteLocked,
    rotationLocked: item.rotationLocked ?? entry.rotationLocked ?? entry.dimensions?.rotationLocked,
    modelUrl: entry.modelUrl || item.modelUrl,
    modelSize: entry.modelSize || item.modelSize,
    materialUrl,
    dimensions,
    color: item.color || entry.color,
    isWallItem: item.isWallItem ?? entry.isWallItem,
    collisionEnabled: item.collisionEnabled ?? entry.collisionEnabled,
  };

  if (isGroup && item.children?.length) {
    hydrated.children = item.children.map((child) => hydrateSceneItemFromCatalog(child, catalogEntries));
  }

  return hydrated;
}

function countSceneItems(sceneItems) {
  return sceneItems.reduce((counts, item) => {
    counts.set(item.type, (counts.get(item.type) || 0) + 1);
    return counts;
  }, new Map());
}

function useSceneTexturePreload(items = [], extraUrls = []) {
  const urls = collectSceneTextureUrls(items, extraUrls);
  const key = urls.join('|');
  const [state, setState] = useState(() => ({ ready: urls.length === 0, loaded: 0, total: urls.length }));

  useEffect(() => {
    if (!urls.length) {
      setState({ ready: true, loaded: 0, total: 0 });
      return undefined;
    }

    let cancelled = false;
    let loaded = 0;
    setState({ ready: false, loaded: 0, total: urls.length });

    Promise.all(urls.map((url) => preloadImage(url).then(() => {
      loaded += 1;
      if (!cancelled) setState({ ready: false, loaded, total: urls.length });
    }))).then(() => {
      if (!cancelled) setState({ ready: true, loaded: urls.length, total: urls.length });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

function useSceneModelFilePreload(items = []) {
  const urls = collectSceneModelUrls(items);
  const key = urls.join('|');
  const [state, setState] = useState(() => ({ ready: urls.length === 0, loaded: 0, total: urls.length }));

  useEffect(() => {
    if (!urls.length) {
      setState({ ready: true, loaded: 0, total: 0 });
      return undefined;
    }

    let cancelled = false;
    let loaded = 0;
    setState({ ready: false, loaded: 0, total: urls.length });

    Promise.all(urls.map((url) => preloadFile(url).then(() => {
      loaded += 1;
      if (!cancelled) setState({ ready: false, loaded, total: urls.length });
    }))).then(() => {
      if (!cancelled) setState({ ready: true, loaded: urls.length, total: urls.length });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

function useSceneSuspendPreload(items = []) {
  const modelItems = useMemo(() => {
    const result = [];
    const visit = (item) => {
      if (!item) return;
      if (item.modelUrl) result.push(item);
      item.children?.forEach(visit);
    };
    (items || []).forEach(visit);
    return result;
  }, [items]);

  const key = modelItems.map((i) => `${i.modelUrl}|${modelMaterialUrl(i) || ''}`).join(',');
  const [state, setState] = useState(() => ({ ready: modelItems.length === 0, loaded: 0, total: modelItems.length }));

  useEffect(() => {
    if (!modelItems.length) {
      setState({ ready: true, loaded: 0, total: 0 });
      return undefined;
    }

    let cancelled = false;
    let loaded = 0;
    setState({ ready: false, loaded: 0, total: modelItems.length });

    const preloadItem = async (item) => {
      const isGlb = item.modelUrl?.toLowerCase().split('?')[0].endsWith('.glb');
      const materialUrl = modelMaterialUrl(item);
      try {
        if (isGlb) {
          const glbEntry = _ensureGlbCacheEntry(item.modelUrl);
          await glbEntry.promise;
        } else {
          let materials = null;
          if (materialUrl) {
            const mtlEntry = _ensureMtlCacheEntry(materialUrl, item);
            await mtlEntry.promise;
            materials = mtlEntry.result ?? null;
            if (materials) {
              const textureUrls = collectMtlTextureUrls(materials, item, materialUrl);
              await Promise.all(textureUrls.map((url) => preloadImage(url)));
            }
          }
          if (item.modelUrl) {
            const objEntry = _ensureObjCacheEntry(item.modelUrl, materials);
            await objEntry.promise;
          }
        }
      } catch {
        // don't block preload on individual item failures
      }
      loaded += 1;
      if (!cancelled) setState({ ready: false, loaded, total: modelItems.length });
    };

    Promise.all(modelItems.map(preloadItem)).then(() => {
      if (!cancelled) setState({ ready: true, loaded: modelItems.length, total: modelItems.length });
    });

    return () => { cancelled = true; };
  }, [key]);

  return state;
}

function combineLoadStates(...states) {
  return states.reduce((acc, state) => ({
    loaded: acc.loaded + Number(state?.loaded || 0),
    total: acc.total + Number(state?.total || 0),
  }), { loaded: 0, total: 0 });
}

function collectSceneTextureUrls(items = [], extraUrls = []) {
  const urls = new Set((extraUrls || []).filter(Boolean));
  const visit = (item) => {
    if (!item) return;
    if (item.options?.headMainImageUrl) urls.add(item.options.headMainImageUrl);
    if (item.options?.posterImageUrl) urls.add(item.options.posterImageUrl);
    if (item.options?.binary3ImageUrl) urls.add(item.options.binary3ImageUrl);

    const referenceUrl = item.modelUrl || item.materialUrl || item.dimensions?.materialUrl || '';
    const storagePaths = Array.isArray(item.dimensions?.storagePaths) ? item.dimensions.storagePaths : [];
    storagePaths.filter(isTextureResource).forEach((path) => {
      const url = publicStorageUrlFromPath(referenceUrl, path);
      if (url) urls.add(url);
    });

    if (item.children?.length) item.children.forEach(visit);
  };

  (items || []).forEach(visit);
  return [...urls];
}

function collectSceneModelUrls(items = []) {
  const urls = new Set();
  const visit = (item) => {
    if (!item) return;
    if (item.modelUrl) urls.add(item.modelUrl);
    const materialUrl = modelMaterialUrl(item);
    if (materialUrl) urls.add(materialUrl);
    if (item.children?.length) item.children.forEach(visit);
  };

  (items || []).forEach(visit);
  return [...urls].filter(Boolean);
}

function logTextureDiagnostic(message, details = {}) {
  if (!import.meta.env.DEV) return;
  console.warn(message, details);
}

function loadDecodedImage(url, attempt = 0, originalUrl = url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ ok: true, url, image: null });
      return;
    }

    const requestUrl = attempt ? textureRetryUrl(originalUrl, attempt) : url;
    const image = new Image();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const retryOrResolve = () => {
      if (attempt < textureRetryAttempts && canRetryTextureUrl(originalUrl)) {
        window.setTimeout(() => {
          loadDecodedImage(textureRetryUrl(originalUrl, attempt + 1), attempt + 1, originalUrl).then(finish);
        }, textureRetryDelay(attempt));
        return;
      }
      logTextureDiagnostic('Texture preload failed after retries', { url: originalUrl });
      finish({ ok: false, url: originalUrl, image: null });
    };
    const decodeAndResolve = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        retryOrResolve();
        return;
      }
      if (typeof image.decode === 'function') {
        image.decode()
          .then(() => {
            cacheDecodedImage(originalUrl, requestUrl, image);
            finish({ ok: true, url: originalUrl, image });
          })
          .catch(retryOrResolve);
        return;
      }
      cacheDecodedImage(originalUrl, requestUrl, image);
      finish({ ok: true, url: originalUrl, image });
    };

    image.crossOrigin = 'anonymous';
    image.onload = decodeAndResolve;
    image.onerror = retryOrResolve;
    image.src = requestUrl;
    if (image.complete && image.naturalWidth > 0) decodeAndResolve();
  });
}

function preloadImage(url, attempt = 0) {
  return loadDecodedImage(url, attempt).then(({ ok }) => ({ ok, url }));
}

function preloadFile(url, attempt = 0) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ ok: true, url });
      return;
    }

    fetch(attempt ? textureRetryUrl(url, attempt) : url, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(() => resolve({ ok: true, url }))
      .catch(() => {
        if (attempt < textureRetryAttempts && canRetryTextureUrl(url)) {
          window.setTimeout(() => {
            preloadFile(textureRetryUrl(url, attempt + 1), attempt + 1).then(resolve);
          }, textureRetryDelay(attempt));
          return;
        }
        logTextureDiagnostic('Model preload failed after retries', { url });
        resolve({ ok: false, url });
      });
  });
}

function cacheDecodedImage(originalUrl, requestedUrl, image) {
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
  textureCacheUrlVariants(originalUrl, requestedUrl).forEach((url) => {
    Cache.remove(`image:${url}`);
    Cache.add(`image:${url}`, image);
  });
}

function textureRetryDelay(attempt = 0) {
  return Math.min(1800, Math.round(textureRetryBaseDelay * (1.55 ** attempt)));
}

function textureCacheUrlVariants(...urls) {
  const variants = new Set();
  urls.filter(Boolean).forEach((url) => {
    variants.add(url);
    try {
      const parsed = new URL(url, window.location.origin);
      variants.add(parsed.href);
      parsed.searchParams.delete('standing_texture_retry');
      variants.add(parsed.href);
      if (parsed.origin === window.location.origin) variants.add(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch {
      variants.add(String(url).replace(/[?&]standing_texture_retry=\d+/, ''));
    }
  });
  return [...variants].filter(Boolean);
}

function SceneTextureLoaderOverlay({ loaded = 0, total = 0 }) {
  const t = useT();
  const progress = total ? Math.round((loaded / total) * 100) : 100;
  return (
    <div className="scene-texture-loader" aria-live="polite">
      <div className="scene-texture-loader-card">
        <Sparkles size={20} />
        <strong>{t('scene_texture_loading')}</strong>
        <span>{t('scene_texture_progress', { progress })}</span>
        <div className="scene-texture-loader-bar"><i style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}

function sceneItemSummary(sceneItems) {
  const summaries = new Map();
  sceneItems.forEach((item) => {
    const current = summaries.get(item.type) || {
      key: item.type,
      label: item.label || catalog.find((entry) => entry.type === item.type)?.label || item.type,
      count: 0,
    };
    current.count += 1;
    summaries.set(item.type, current);
  });
  return [...summaries.values()];
}

function defaultIncludedFurniture() {
  return [
    { key: 'counter', label: 'Comptoir', count: 1 },
    { key: 'stool', label: 'Tabouret', count: 2 },
    { key: 'high-table', label: 'Mange-debout', count: 1 },
  ];
}

function furniturePanelCategory(entry) {
  const text = `${entry?.type || ''} ${entry?.label || ''}`.toLowerCase();
  const category = String(entry?.dimensions?.category || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (entry?.isGroup) return 'hidden';
  if (isLedRailEntry(entry)) return 'hidden';
  if (category.includes('sol') || category.includes('cloison')) return 'structure';
  if (text.includes('cloison') || text.includes('porte poussant')) return 'structure';
  if (category.includes('multimedia')) return 'multimedia';
  if (category.includes('mobilier')) return 'furniture';
  if (isWallItemType(entry?.type) || /tv|ecran|écran|borne|led|multimedia|multimédia|caisson/.test(text)) return 'multimedia';
  return 'furniture';
}

function formatFurniturePrice(entry, salonLabel) {
  const price = assetUnitPrice(entry, salonLabel);
  if (!price) return '+ 0 €';
  return `+ ${price.toLocaleString('fr-FR')} €`;
}

function assetUnitPrice(entry, salonLabel) {
  const salonPricing = getSalonPricing(entry, salonLabel);
  const defaultPrices = {
    chair: 72,
    table: 93,
    counter: 144,
    screen: 450,
  };
  return firstPriceValue(
    salonPricing.price,
    entry?.price,
    entry?.dimensions?.price,
    entry?.optionPrice,
    defaultPrices[entry?.type],
    0,
  );
}

function assetReference(entry, salonLabel) {
  return getSalonPricing(entry, salonLabel).reference || entry?.dimensions?.reference || '';
}

function getSalonPricing(assetOrEntry, salonLabel) {
  const pricing = assetOrEntry?.dimensions?.salonPricing || assetOrEntry?.salonPricing || {};
  const directKey = salonPricingKey(salonLabel);
  const direct = pricing[directKey];
  if (direct) return direct;
  const normalized = normalizeSalonLabel(salonLabel);
  return Object.entries(pricing).find(([, value]) => normalizeSalonLabel(value?.salon || '') === normalized)?.[1] || {};
}

function salonPricingKey(salonLabel) {
  return slugForType(salonLabel || 'salon');
}

function firstPriceValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function placementRuleFromId(id) {
  if (!id || id === 'free') return null;
  return { id, locked: true };
}

function normalizePlacementRule(rule) {
  if (!rule) return null;
  if (typeof rule === 'string') return placementRuleFromId(rule);
  if (!rule.id || rule.id === 'free') return null;
  return { id: rule.id, locked: rule.locked !== false };
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key);
}

function placementRuleValue(assetOrEntry = {}) {
  if (hasOwn(assetOrEntry, 'placementRule')) return assetOrEntry.placementRule;
  if (hasOwn(assetOrEntry.dimensions, 'placementRule')) return assetOrEntry.dimensions.placementRule;
  return defaultPlacementRuleForAsset(assetOrEntry);
}

function effectivePlacementRule(assetOrEntry = {}) {
  return normalizePlacementRule(placementRuleValue(assetOrEntry));
}

function defaultPlacementRuleForAsset(assetOrEntry = {}) {
  if (!isSmclPartitionHeadItem(assetOrEntry)) return null;
  const side = smclPartitionHeadSide(assetOrEntry);
  if (side === 'left') return placementRuleFromId('outer-left');
  if (side === 'right') return placementRuleFromId('outer-right');
  return null;
}

function isLockedPlacementRule(rule) {
  return Boolean(normalizePlacementRule(rule)?.locked);
}

function itemPlacementLocked(item) {
  return Boolean(item?.lockedPlacement || isLockedPlacementRule(item?.placementRule));
}

function itemMovementLocked(item) {
  return Boolean(item?.movementLocked || item?.dimensions?.movementLocked);
}

function itemDeletionLocked(item) {
  return Boolean(item?.deleteLocked || item?.dimensions?.deleteLocked);
}

function itemRotationLocked(item) {
  return Boolean(item?.rotationLocked || item?.dimensions?.rotationLocked);
}

function isCeilingMountedItem(item = {}, entry = null) {
  return Boolean(item?.ceilingMounted || item?.dimensions?.ceilingMounted || entry?.dimensions?.ceilingMounted);
}

function floorItemBaseY(item = {}, entry = null) {
  if (!isCeilingMountedItem(item, entry)) return 0;
  const y = Number(item?.dimensions?.ceilingBottomY ?? entry?.dimensions?.ceilingBottomY ?? ceilingObjectBottomY);
  return Number.isFinite(y) ? y : ceilingObjectBottomY;
}

function placementRuleLabel(id, withDescription = false) {
  const option = placementRuleOptions.find((item) => item.id === id) || placementRuleOptions[0];
  return withDescription ? option.description : option.label;
}

function salonShortLabel(salon) {
  if (!salon) return 'Salon';
  return salon.replace(/\s*20\d{2}/, '').split(/[—/-]/)[0].trim();
}

function availableWalls(layout) {
  if (layout === 'left') return [{ id: 'back', label: 'Fond' }, { id: 'left', label: 'Gauche' }];
  if (layout === 'right') return [{ id: 'back', label: 'Fond' }, { id: 'right', label: 'Droite' }];
  if (layout === 'back') return [{ id: 'back', label: 'Fond' }];
  return [
    { id: 'back', label: 'Fond' },
    { id: 'left', label: 'Gauche' },
    { id: 'right', label: 'Droite' },
  ];
}

function wallCoverSurfaceOptions(layout, width, depth, items = []) {
  const sideDepth = Math.max(0.01, Number(depth || 0) - wallThickness);
  const sideZ = -Number(depth || 0) / 2 + wallThickness + sideDepth / 2;
  const wallSurfaces = availableWalls(layout).map((wall) => {
    if (wall.id === 'left') {
      return {
        id: 'left',
        label: 'Cloison gauche',
        kind: 'wall',
        wall: 'left',
        width: sideDepth,
        height: fixedWallHeight,
        position: [-Number(width || 0) / 2 + wallThickness + 0.0015, fixedWallHeight / 2, sideZ],
        rotation: Math.PI / 2,
      };
    }
    if (wall.id === 'right') {
      return {
        id: 'right',
        label: 'Cloison droite',
        kind: 'wall',
        wall: 'right',
        width: sideDepth,
        height: fixedWallHeight,
        position: [Number(width || 0) / 2 - wallThickness - 0.0015, fixedWallHeight / 2, sideZ],
        rotation: -Math.PI / 2,
      };
    }
    return {
      id: 'back',
      label: 'Cloison arrière',
      kind: 'wall',
      wall: 'back',
      width: Number(width || 0),
      height: fixedWallHeight,
      position: [0, fixedWallHeight / 2, -Number(depth || 0) / 2 + wallThickness + 0.0015],
      rotation: 0,
    };
  }).map((surface) => ({
    ...surface,
    visibleWidth: wallCoverVisibleWidth(surface, items, width, depth),
  }));

  const reserveSurface = objectWallSurfaces(items)
    .filter((surface) => String(surface.id || '').includes('reserve') || surface.protectedBounds)
    .sort((a, b) => Number(b.length || 0) - Number(a.length || 0))[0];

  if (!reserveSurface) return wallSurfaces;

  const outsideSide = protectedObjectWallSideContains(reserveSurface, reserveSurface.centerAxis, 1) ? -1 : 1;
  const reserveFaceOffset = wallThickness / 2 + 0.004;
  return [
    ...wallSurfaces,
    {
      id: 'reserve',
      label: 'Cloison réserve',
      kind: 'reserve',
      wall: 'reserve',
      width: Math.max(0.5, Number(reserveSurface.length || 1)),
      height: fixedWallHeight,
      position: reserveSurface.orientation === 'x'
        ? [reserveSurface.centerAxis, fixedWallHeight / 2, reserveSurface.normalAxis + outsideSide * reserveFaceOffset]
        : [reserveSurface.normalAxis + outsideSide * reserveFaceOffset, fixedWallHeight / 2, reserveSurface.centerAxis],
      rotation: reserveSurface.orientation === 'x'
        ? (outsideSide >= 0 ? 0 : Math.PI)
        : (outsideSide >= 0 ? Math.PI / 2 : -Math.PI / 2),
      visibleWidth: Math.max(0.5, Number(reserveSurface.length || 1)),
    },
  ];
}

function wallCoverVisibleWidth(surface, items, width, depth) {
  return wallCoverSegmentsForSurface(surface, items, width, depth).reduce((sum, segment) => sum + Number(segment.width || 0), 0);
}

function wallCoverSegmentsForSurface(surface, items = [], width = 0, depth = 0) {
  if (!surface) return [];
  if (surface.kind === 'reserve') return [surface];
  const wall = surface.wall || surface.id;
  const range = wallAxisLimits(wall, width, depth);
  const fakePoster = { id: `wall-cover-${wall}`, type: 'poster', wall };
  const intervals = freeWallIntervals(
    range,
    wallBlockers(fakePoster, items, width, depth, wall)
      .map((blocker) => ({ min: clamp(blocker.min, range.min, range.max), max: clamp(blocker.max, range.min, range.max) }))
      .filter((blocker) => blocker.max > blocker.min),
  );
  return intervals
    .filter((interval) => interval.max - interval.min >= 0.2)
    .map((interval, index) => wallCoverSegmentFromInterval(surface, interval, width, depth, index));
}

function wallCoverSegmentFromInterval(surface, interval, width, depth, index = 0) {
  const segmentWidth = Math.max(0.01, interval.max - interval.min);
  const center = (interval.min + interval.max) / 2;
  const offset = 0.0015;
  if (surface.wall === 'left') {
    return {
      ...surface,
      id: `${surface.id}-${index}`,
      width: segmentWidth,
      position: [-Number(width || 0) / 2 + wallThickness + offset, fixedWallHeight / 2, center],
      rotation: Math.PI / 2,
    };
  }
  if (surface.wall === 'right') {
    return {
      ...surface,
      id: `${surface.id}-${index}`,
      width: segmentWidth,
      position: [Number(width || 0) / 2 - wallThickness - offset, fixedWallHeight / 2, center],
      rotation: -Math.PI / 2,
    };
  }
  return {
    ...surface,
    id: `${surface.id}-${index}`,
    width: segmentWidth,
    position: [center, fixedWallHeight / 2, -Number(depth || 0) / 2 + wallThickness + offset],
    rotation: 0,
  };
}

function ledSpotCountForArea(area) {
  return Math.max(1, Math.ceil(Number(area || 0) / ledSpotAreaMeters));
}

function isLedRailEntry(item = {}) {
  return Boolean(item?.isLedSpotOption || item?.dimensions?.isLedSpotOption || isLedRailModelEntry(item));
}

function isLedRailModelEntry(item = {}) {
  const text = normalizedItemText(item);
  return text.includes('rail') && text.includes('led') && /(?:^|[^0-9])[23]\s*spots?/.test(text);
}

function ledRailCatalogEntries(entries = []) {
  const rails = (entries || []).filter((entry) => isLedRailModelEntry(entry));
  if (rails.length) return rails;
  return (entries || []).filter((entry) => isLedRailEntry(entry));
}

function isAutomaticLedRailItem(item = {}) {
  return Boolean(item?.autoLedRail || item?.dimensions?.autoLedRail);
}

function isAutomaticSpotItem(item = {}) {
  return Boolean(item?.autoSpot || item?.dimensions?.autoSpot);
}

function autoSpotsRailCount(rule, area) {
  if (!rule?.type || !rule?.spotsPerRail) return 0;
  const spotsPerRail = Math.max(1, Number(rule.spotsPerRail || 1));
  const spotsNeeded = Math.max(1, Math.round(Number(area || 0) / ledSpotAreaMeters));
  return Math.max(1, Math.round(spotsNeeded / spotsPerRail));
}

function freeWallIntervals(range, blockers) {
  let intervals = [{ min: range.min, max: range.max }];
  for (const blocker of blockers) {
    const next = [];
    for (const iv of intervals) {
      if (blocker.max <= iv.min || blocker.min >= iv.max) {
        next.push(iv);
      } else {
        if (blocker.min > iv.min + 0.01) next.push({ min: iv.min, max: blocker.min });
        if (blocker.max < iv.max - 0.01) next.push({ min: blocker.max, max: iv.max });
      }
    }
    intervals = next;
  }
  return intervals.filter((iv) => iv.max - iv.min > 0.1);
}

function distributeInFreeIntervals(count, intervals) {
  if (!count || !intervals.length) return [];
  const totalFree = intervals.reduce((sum, iv) => sum + (iv.max - iv.min), 0);
  if (!totalFree) return [];
  const step = totalFree / (count + 1);
  const positions = [];
  let distSoFar = 0;
  let nextTarget = step;
  for (const iv of intervals) {
    const ivLen = iv.max - iv.min;
    while (nextTarget <= distSoFar + ivLen + 0.001 && positions.length < count) {
      positions.push(iv.min + (nextTarget - distSoFar));
      nextTarget += step;
    }
    distSoFar += ivLen;
  }
  return positions;
}

function makeAutomaticSpotItems(rule, catalogEntries, width, depth, layout, contextItems = []) {
  if (!rule?.type) return [];
  const entry = findCatalogEntry(catalogEntries, rule.type);
  if (!entry) return [];
  const area = Number(width || 0) * Number(depth || 0);
  const railCount = autoSpotsRailCount(rule, area);
  const walls = availableWalls(layout);
  const totalLength = walls.reduce((sum, wall) => sum + wallLength(wall.id, width, depth), 0);
  const allocations = walls.map((wall) => {
    const exact = (railCount * wallLength(wall.id, width, depth)) / Math.max(totalLength, 0.01);
    return { wall: wall.id, count: Math.floor(exact), remainder: exact % 1 };
  });
  let allocated = allocations.reduce((sum, a) => sum + a.count, 0);
  [...allocations].sort((a, b) => b.remainder - a.remainder).forEach((a) => {
    if (allocated >= railCount) return;
    a.count += 1;
    allocated += 1;
  });
  const dummyItem = { id: '__spot_placer__' };
  return allocations.flatMap(({ wall: wallId, count }) => {
    if (!count) return [];
      const itemBase = {
        ...makeItem(entry.type, width, depth, layout, entry),
        autoSpot: true,
        autoLedRail: true,
        included: true,
        priceMode: 'included',
        lockedPlacement: false,
        collisionEnabled: false,
        wall: wallId,
      y: ledRailCenterY(entry),
      dimensions: {
          ...(entry.dimensions || {}),
          autoSpot: true,
          autoLedRail: true,
          collisionEnabled: false,
          wallY: ledRailCenterY(entry),
        },
    };
    const range = wallItemAxisRange(itemBase, wallId, width, depth);
    const blockers = wallBlockers(dummyItem, contextItems, width, depth, wallId);
    const freeIntervals = freeWallIntervals(range, blockers);
    const positions = distributeInFreeIntervals(count, freeIntervals.length ? freeIntervals : [range]);
    return positions.map((rawAxis, index) => {
      const axis = clamp(snapWallAxis(rawAxis), range.min, range.max);
      return constrainItem({ ...itemBase, id: `auto-spot-${wallId}-${index + 1}`, x: axis }, width, depth, layout);
    });
  });
}

function isAutomaticReserveItem(item = {}) {
  return Boolean(item?.autoReserve || item?.dimensions?.autoReserve);
}

function applyReserveItemOverride(item, overrides = {}, width, depth, layout, carpetFootprintEnabled = true) {
  const override = overrides?.[item.id];
  if (!override) return item;
  return constrainItem({
    ...item,
    ...override,
    autoReserve: true,
    included: item.included !== false,
    priceMode: item.priceMode || 'included',
  }, width, depth, layout, carpetFootprintEnabled);
}

function pickReserveItemOverride(item) {
  return {
    x: Number(item.x || 0),
    z: Number(item.z || 0),
    rotation: Number(item.rotation || 0),
    placementRule: item.placementRule || null,
    lockedPlacement: Boolean(item.lockedPlacement),
  };
}

function applyLedRailOverride(item, overrides = {}, width, depth, layout) {
  const override = overrides?.[item.id];
  if (!override) return item;
  return constrainItem({
    ...item,
    ...override,
    autoLedRail: true,
    included: true,
    priceMode: 'included',
    collisionEnabled: false,
    lockedPlacement: false,
    dimensions: {
      ...(item.dimensions || {}),
      autoLedRail: true,
      collisionEnabled: false,
    },
  }, width, depth, layout);
}

function pickLedRailOverride(item) {
  return {
    wall: item.wall || 'back',
    x: Number(item.x || 0),
    z: Number(item.z || 0),
    wallSide: item.wallSide || null,
    wallSurface: item.wallSurface || null,
  };
}

function defaultWallItemCenterY(entry, type) {
  if (isTelevisionItem({ ...entry, type })) return screenCenterHeight;
  if (type === 'poster') return fixedWallHeight / 2;
  if (isLedRailEntry(entry)) return ledRailCenterY(entry);
  if (isPartitionHeadItem(entry)) return 0;
  const y = Number(entry?.dimensions?.wallY);
  return Number.isFinite(y) && y >= 0 ? y : 0;
}

function ledRailCenterY(entry) {
  const y = Number(entry?.dimensions?.wallY ?? entry?.y);
  return Number.isFinite(y) && y > 0 ? y : ledRailDefaultCenterY;
}

function makeAutomaticLedRailItems(entries, width, depth, layout, spotCount) {
  const railPlan = makeLedRailPlan(entries, spotCount);
  if (!railPlan.length) return [];
  const railCount = railPlan.length;
  const walls = availableWalls(layout);
  const totalLength = walls.reduce((sum, wall) => sum + wallLength(wall.id, width, depth), 0);
  const allocations = walls.map((wall) => {
    const exact = (railCount * wallLength(wall.id, width, depth)) / Math.max(totalLength, 0.01);
    return { wall: wall.id, count: Math.floor(exact), remainder: exact % 1 };
  });
  let allocated = allocations.reduce((sum, item) => sum + item.count, 0);
  [...allocations]
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (allocated >= railCount) return;
      item.count += 1;
      allocated += 1;
    });

  let railIndex = 0;
  return allocations.flatMap((allocation) => {
    const wallEntries = railPlan.slice(railIndex, railIndex + allocation.count);
    railIndex += allocation.count;
    if (!wallEntries.length) return [];
    const baseItem = {
      autoLedRail: true,
      included: true,
      priceMode: 'included',
      lockedPlacement: false,
      collisionEnabled: false,
      wall: allocation.wall,
    };
    return wallEntries.map((entry, index) => {
      const itemBase = {
        ...makeItem(entry.type, width, depth, layout, entry),
        ...baseItem,
        y: ledRailCenterY(entry),
        dimensions: {
          ...(entry.dimensions || {}),
          autoLedRail: true,
          collisionEnabled: false,
          wallY: ledRailCenterY(entry),
        },
      };
      const range = wallItemAxisRange(itemBase, allocation.wall, width, depth);
      const rawAxis = range.min + ((index + 1) * (range.max - range.min)) / (allocation.count + 1);
      const axis = clamp(snapWallAxis(rawAxis), range.min, range.max);
      return constrainItem({
        ...itemBase,
        id: `auto-led-${entry.type}-${allocation.wall}-${index + 1}`,
        x: axis,
      }, width, depth, layout);
    });
  });
}

function makeLedRailPlan(entries, spotCount) {
  const catalogEntries = Array.isArray(entries) ? entries : [entries].filter(Boolean);
  if (!catalogEntries.length || !spotCount) return [];
  const twoSpotRail = catalogEntries.find((entry) => ledSpotsPerRail(entry) === 2) || null;
  const threeSpotRail = catalogEntries.find((entry) => ledSpotsPerRail(entry) === 3) || null;
  const fallbackRail = threeSpotRail || twoSpotRail || catalogEntries[0];
  const wanted = Math.max(1, Number(spotCount || 0));
  const plan = [];

  if (!twoSpotRail || !threeSpotRail) {
    const spotsPerRail = Math.max(1, ledSpotsPerRail(fallbackRail));
    return Array.from({ length: Math.max(1, Math.ceil(wanted / spotsPerRail)) }, () => fallbackRail);
  }

  if (wanted <= 2) {
    plan.push(twoSpotRail);
  } else if (wanted === 3) {
    plan.push(threeSpotRail);
  } else if (wanted % 2 === 1) {
    plan.push(threeSpotRail);
    for (let remaining = wanted - 3; remaining > 0; remaining -= 2) plan.push(twoSpotRail);
  } else if (wanted % 3 === 0) {
    for (let remaining = wanted; remaining > 0; remaining -= 3) plan.push(threeSpotRail);
  } else {
    for (let remaining = wanted; remaining > 0; remaining -= 2) plan.push(twoSpotRail);
  }

  return plan;
}

function ledSpotsPerRail(entry = {}) {
  const text = `${entry?.label || ''} ${entry?.type || ''}`.toLowerCase();
  const match = text.match(/(\d+)\s*spots?/);
  const spots = Number(match?.[1]);
  return Number.isFinite(spots) && spots > 0 ? spots : 1;
}

function wallLength(wall, width, depth) {
  return wall === 'back' ? Number(width || 0) : Number(depth || 0);
}

function wallLabel(wall) {
  if (wall === 'left') return 'Gauche';
  if (wall === 'right') return 'Droite';
  return 'Fond';
}

function layoutLabel(layout) {
  if (layout === 'left') return 'Arriere gauche';
  if (layout === 'back') return 'Arriere';
  if (layout === 'right') return 'Arriere droite';
  return 'U';
}

function statusLabel(status) {
  const labels = {
    created: 'Cree',
    configured: 'Configure',
    bat_pending: 'BAT a valider',
    validated: 'Valide',
  };
  return labels[status] || status || 'A definir';
}

function clientStatusLabel(status) {
  const labels = {
    not_started: 'Pas encore configure',
    draft: 'Brouillon',
    configured: 'Configure',
    bat_review: 'BAT en annotation',
    bat_validated: 'BAT valide',
  };
  return labels[status] || status || 'A definir';
}

function fileSummary(files = []) {
  if (!files.length) return 'Aucun';
  return files.map((file) => fileTypeLabel(file.type)).join(', ');
}

function fileTypeLabel(type) {
  const labels = {
    technical_plan: 'Plan technique',
    bat: 'BAT',
    client_annotation: 'Annotation',
    asset: 'Asset',
  };
  return labels[type] || 'Fichier';
}

function isWallItemType(type) {
  return ['screen', 'poster'].includes(type);
}

function isTelevisionItem(item = {}) {
  return Boolean(item?.type === 'screen' || item?.isTelevision || item?.dimensions?.isTelevision);
}

function isCenterAnchoredWallModel(item = {}) {
  return isTelevisionItem(item);
}

function assetPlacementMode(assetOrEntry = {}) {
  const mountType = assetOrEntry?.dimensions?.mountType || assetOrEntry?.mountType;
  if (isTelevisionItem(assetOrEntry)) return 'wall';
  if (isCeilingMountedItem(assetOrEntry)) return 'floor';
  if (isLedRailEntry(assetOrEntry)) return 'wall';
  return mountType === 'wall' ? 'wall' : 'floor';
}

function isCatalogWallEntry(entry, type) {
  return isWallItemType(type) || assetPlacementMode(entry) === 'wall' || Boolean(entry?.isWallItem);
}

function isWallItem(item) {
  return isWallItemType(item?.type) || Boolean(item?.wall && item?.isWallItem);
}

function isPosterItem(item = {}) {
  return item?.type === 'poster';
}

function isReserveSceneItem(item = {}) {
  return Boolean(isAutomaticReserveItem(item) || item?.dimensions?.isReserve || normalizedItemText(item).includes('reserve'));
}

function isPosterBlockingItem(item = {}) {
  return isReserveSceneItem(item) || isPartitionHeadItem(item) || isAutomaticPartitionHeadItem(item);
}

function isPartitionHeadItem(item = {}) {
  const text = `${item.type || ''} ${item.label || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return text.includes('tete de cloison');
}

function isSmclPartitionHeadItem(item = {}) {
  const text = normalizedItemText(item);
  return text.includes('tete de cloison') && text.includes('smcl');
}

function smclPartitionHeadSide(item = {}) {
  const text = normalizedItemText(item);
  if (text.includes('gauche')) return 'left';
  if (text.includes('droite')) return 'right';
  return '';
}

function normalizedItemText(item = {}) {
  return `${item.type || ''} ${item.label || ''} ${item.dimensions?.folderName || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function savedContactDetail(scene = {}, key = '') {
  return scene.source_payload?.contactDetails?.[key] || '';
}

function userInitials(firstName = '', lastName = '', fallback = '') {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const fallbackParts = String(fallback || '').trim().split(/\s+/).filter(Boolean);
  const chars = [first[0], last[0]].filter(Boolean);
  const source = chars.length ? chars : fallbackParts.slice(0, 2).map((part) => part[0]);
  return (source.join('') || 'ST').toUpperCase();
}

function sceneExhibitorCompanyName(scene = {}, clientInfo = {}, contactDetails = {}) {
  return scene.source_payload?.name
    || scene.source_payload?.item?.name
    || scene.source_payload?.client_name
    || scene.source_payload?.company_name
    || scene.project_name
    || clientInfo.client
    || contactDetails.company
    || scene.client_name
    || '';
}

function sceneStandNumber(scene = {}, contactDetails = {}, standLabel = '') {
  return scene.source_payload?.stand_number
    || mondayColumnTextAny(scene.source_payload, ['n_', 'n°', 'numero', 'numéro'])
    || contactDetails.emplacement
    || standLabel.replace(/^Stand\s+/i, '')
    || '';
}

function sceneAisleNumber(scene = {}, contactDetails = {}) {
  return scene.source_payload?.aisle_number
    || scene.source_payload?.allee
    || mondayColumnTextAny(scene.source_payload, ['text5', 'allée', 'allee'])
    || contactDetails.allee
    || '';
}

function sceneHallLabel(scene = {}, contactDetails = {}) {
  return scene.source_payload?.hall
    || mondayColumnTextAny(scene.source_payload, ['hall', 'pavillon'])
    || contactDetails.hall
    || 'À définir';
}

function sceneSectorLabel(scene = {}) {
  return scene.source_payload?.sector
    || scene.source_payload?.secteur
    || mondayColumnTextAny(scene.source_payload, ['dup__of_secteur1', 'secteur'])
    || '';
}

function mondayColumnText(sourcePayload = {}, columnId = '') {
  if (!columnId || !Array.isArray(sourcePayload?.column_values)) return '';
  return sourcePayload.column_values.find((column) => column.id === columnId)?.text || '';
}

function mondayColumnTextAny(sourcePayload = {}, keys = []) {
  if (!Array.isArray(keys)) return mondayColumnText(sourcePayload, keys);
  for (const key of keys) {
    const direct = mondayColumnText(sourcePayload, key);
    if (direct) return direct;
  }
  if (!Array.isArray(sourcePayload?.column_values)) return '';
  const normalizedKeys = keys.map(normalizeLookupText).filter(Boolean);
  return sourcePayload.column_values.find((column) => {
    const candidates = [column.id, column.title, column.column?.title, column.text];
    return candidates.some((candidate) => normalizedKeys.includes(normalizeLookupText(candidate)));
  })?.text || '';
}

function normalizeLookupText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function languageFlag(language = 'fr') {
  return language === 'en' ? '🇬🇧' : '🇫🇷';
}

function itemCollisionEnabled(item) {
  return item?.collisionEnabled !== false && item?.dimensions?.collisionEnabled !== false;
}

function snapWallAxis(value) {
  return Number((Math.round(Number(value || 0) / wallItemSnap) * wallItemSnap).toFixed(2));
}

function standFloorBounds(width, depth, layout) {
  const hasLeftWall = layout === 'left' || layout === 'u';
  const hasRightWall = layout === 'right' || layout === 'u';
  return {
    minX: -width / 2 + (hasLeftWall ? wallThickness : 0),
    maxX: width / 2 - (hasRightWall ? wallThickness : 0),
    minZ: -depth / 2 + wallThickness,
    maxZ: depth / 2,
  };
}

function carpetFootprintBounds(width, depth, layout) {
  const side = layout === 'right' ? 'left' : layout === 'left' ? 'right' : 'center';
  const maxZ = depth / 2 + carpetFootprintOverflow;
  const minZ = maxZ - carpetFootprintSizeMeters;
  let minX = -carpetFootprintSizeMeters / 2;
  let maxX = carpetFootprintSizeMeters / 2;

  if (layout === 'u') {
    maxX = width / 2 - wallThickness - carpetFootprintOverflow;
    minX = maxX - carpetFootprintSizeMeters;
    return { minX, maxX, minZ, maxZ };
  }

  if (side === 'right') {
    maxX = width / 2 + carpetFootprintOverflow;
    minX = maxX - carpetFootprintSizeMeters;
  }

  if (side === 'left') {
    minX = -width / 2 - carpetFootprintOverflow;
    maxX = minX + carpetFootprintSizeMeters;
  }

  return { minX, maxX, minZ, maxZ };
}

function rectSize(rect) {
  return {
    ...rect,
    width: rect.maxX - rect.minX,
    depth: rect.maxZ - rect.minZ,
    centerX: (rect.minX + rect.maxX) / 2,
    centerZ: (rect.minZ + rect.maxZ) / 2,
  };
}

function placementRegions(width, depth, layout, itemBounds, carpetFootprintEnabled = true) {
  const regions = [standFloorBounds(width, depth, layout)];
  if (carpetFootprintEnabled) regions.push(carpetFootprintBounds(width, depth, layout));
  return regions
    .map((rect) => itemAllowedRegion(rect, itemBounds))
    .filter(Boolean);
}

function itemAllowedRegion(rect, itemBounds) {
  const region = {
    minX: rect.minX - itemBounds.minX,
    maxX: rect.maxX - itemBounds.maxX,
    minZ: rect.minZ - itemBounds.minZ,
    maxZ: rect.maxZ - itemBounds.maxZ,
  };
  return region.minX <= region.maxX && region.minZ <= region.maxZ ? region : null;
}

function clampToRegion(item, region) {
  return {
    x: clamp(item.x, region.minX, region.maxX),
    z: clamp(item.z, region.minZ, region.maxZ),
  };
}

function pointInRegion(item, region) {
  return item.x >= region.minX && item.x <= region.maxX && item.z >= region.minZ && item.z <= region.maxZ;
}

function closestPlacementInRegions(item, regions) {
  if (!regions.length) return { x: item.x, z: item.z };
  const containingRegion = regions.find((region) => pointInRegion(item, region));
  if (containingRegion) return { x: item.x, z: item.z };

  return regions
    .map((region) => {
      const position = clampToRegion(item, region);
      return { ...position, distance: Math.hypot(position.x - item.x, position.z - item.z) };
    })
    .sort((a, b) => a.distance - b.distance)[0];
}

function wallItemAxisRange(item, wall, width, depth) {
  const limits = wallAxisLimits(wall, width, depth);
  const bounds = wallItemAxisBounds(item, wall);
  const sideMargin = isPartitionHeadItem(item) ? partitionHeadEdgeInset : 0;
  return {
    min: limits.min - bounds.min + sideMargin,
    max: limits.max - bounds.max - sideMargin,
  };
}

function wallAxisLimits(wall, width, depth) {
  if (wall === 'back') return { min: -width / 2, max: width / 2 };
  return { min: -depth / 2 + wallThickness, max: depth / 2 };
}

function wallItemAxisBounds(item, wall = 'back') {
  if (item?.type === 'poster') return { min: -0.5, max: 0.5 };
  const bounds = itemGroupBounds(item);
  if (wall === 'left') {
    return { min: -Number(bounds.maxX || 0), max: -Number(bounds.minX || 0) };
  }
  return { min: Number(bounds.minX || -0.55), max: Number(bounds.maxX || 0.55) };
}

function wallFromDrag(point, currentWall, width, depth, layout) {
  const validWalls = availableWalls(layout).map((wall) => wall.id);
  const current = validWalls.includes(currentWall) ? currentWall : 'back';

  const wallZones = [
    { wall: 'back', distance: Math.abs(point.z + depth / 2) },
    { wall: 'left', distance: Math.abs(point.x + width / 2) },
    { wall: 'right', distance: Math.abs(point.x - width / 2) },
  ].filter((zone) => validWalls.includes(zone.wall) && zone.distance <= wallSwitchZone);

  if (!wallZones.length) return current;

  const closest = wallZones.sort((a, b) => a.distance - b.distance)[0];
  const currentZone = wallZones.find((zone) => zone.wall === current);
  if (currentZone && closest.wall !== current && closest.distance + wallSwitchHysteresis >= currentZone.distance) {
    return current;
  }

  return closest.wall;
}

function wallDragPatch(point, dragged, items, width, depth, layout) {
  const fixedY = isTelevisionItem(dragged) ? { y: screenCenterHeight } : {};
  const objectWall = objectWallFromDrag(point, items, dragged.id);
  if (objectWall) {
    return {
      wall: objectWall.surface.id,
      x: objectWall.axis,
      wallSide: objectWall.side,
      wallSurface: serializeObjectWallSurface(objectWall.surface),
      ...fixedY,
    };
  }

  const wall = wallFromDrag(point, dragged.wall, width, depth, layout);
  return {
    wall,
    x: wall === 'back' ? point.x : point.z,
    wallSide: null,
    wallSurface: null,
    ...fixedY,
  };
}

function objectWallFromDrag(point, items, ignoreId = null) {
  const candidates = objectWallSurfaces(items, ignoreId)
    .map((surface) => {
      const halfLength = surface.length / 2;
      const minAxis = surface.centerAxis - halfLength - objectWallAxisPadding;
      const maxAxis = surface.centerAxis + halfLength + objectWallAxisPadding;
      const axisValue = surface.orientation === 'x' ? point.x : point.z;
      const normalValue = surface.orientation === 'x' ? point.z : point.x;
      if (axisValue < minAxis || axisValue > maxAxis) return null;
      const distance = Math.abs(normalValue - surface.normalAxis);
      if (distance > objectWallSnapThreshold) return null;
      const rawSide = normalValue >= surface.normalAxis ? 1 : -1;
      const axis = snapWallAxis(clamp(axisValue, surface.centerAxis - halfLength, surface.centerAxis + halfLength));
      const side = safeObjectWallSide(surface, axis, rawSide);
      if (!side) return null;
      return {
        surface,
        axis,
        side,
        distance,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0] || null;
}

function serializeObjectWallSurface(surface) {
  return surface ? {
    id: surface.id,
    orientation: surface.orientation,
    centerX: surface.centerX,
    centerZ: surface.centerZ,
    centerAxis: surface.centerAxis,
    normalAxis: surface.normalAxis,
    length: surface.length,
    protectedBounds: surface.protectedBounds || null,
  } : null;
}

function objectWallSurfaces(items = [], ignoreId = null) {
  return (items || [])
    .filter((item) => item && item.id !== ignoreId && !isWallItem(item) && itemCollisionEnabled(item))
    .flatMap((item) => {
      if (item.isGroup && item.children?.length) return groupObjectWallSurfaces(item);
      return wallSurfaceCandidate(item, item.id, item.x || 0, item.z || 0, item.rotation || 0);
    })
    .filter(Boolean);
}

function groupObjectWallSurfaces(group) {
  const groupRotation = Number(group.rotation || 0);
  const protectedBounds = isReserveSceneItem(group) ? itemHardCollisionBox(group) : null;
  const surfaces = (group.children || [])
    .flatMap((child) => {
      const rotated = rotatePoint(Number(child.x || 0), Number(child.z || 0), groupRotation);
      const surface = wallSurfaceCandidate(
        child,
        `${group.id}:${child.id}`,
        Number(group.x || 0) + rotated.x,
        Number(group.z || 0) + rotated.z,
        groupRotation + Number(child.rotation || 0),
      );
      return surface && protectedBounds ? { ...surface, protectedBounds } : surface;
    })
    .filter(Boolean);
  return mergeObjectWallSurfaces(group.id, surfaces)
    .filter((surface) => !protectedBounds || isProtectedBoundarySurface(surface, protectedBounds));
}

function mergeObjectWallSurfaces(groupId, surfaces = []) {
  const groups = new Map();
  surfaces.forEach((surface) => {
    const normalKey = Math.round(Number(surface.normalAxis || 0) * 20) / 20;
    const key = `${surface.orientation}:${normalKey}`;
    groups.set(key, [...(groups.get(key) || []), surface]);
  });

  return [...groups.values()].flatMap((groupSurfaces, groupIndex) => {
    const sorted = [...groupSurfaces].sort((a, b) => (a.centerAxis - a.length / 2) - (b.centerAxis - b.length / 2));
    const merged = [];
    sorted.forEach((surface) => {
      const min = surface.centerAxis - surface.length / 2;
      const max = surface.centerAxis + surface.length / 2;
      const previous = merged[merged.length - 1];
      if (previous && min <= previous.max + 0.12) {
        previous.max = Math.max(previous.max, max);
        previous.normalAxis = (previous.normalAxis + surface.normalAxis) / 2;
        return;
      }
      merged.push({ ...surface, min, max });
    });

    return merged.map((surface, index) => {
      const centerAxis = (surface.min + surface.max) / 2;
      const length = Math.max(0.1, surface.max - surface.min);
      return {
        ...surface,
        id: `object-wall:${groupId}:merged-${groupIndex}-${index}`,
        centerAxis,
        length,
        centerX: surface.orientation === 'x' ? centerAxis : surface.normalAxis,
        centerZ: surface.orientation === 'x' ? surface.normalAxis : centerAxis,
        protectedBounds: surface.protectedBounds || null,
      };
    });
  });
}

function protectedObjectWallSideContains(surface = {}, axis = 0, side = 1) {
  const bounds = surface.protectedBounds;
  if (!bounds) return false;
  const probeOffset = 0.08;
  const x = surface.orientation === 'x' ? axis : Number(surface.normalAxis || 0) + side * probeOffset;
  const z = surface.orientation === 'x' ? Number(surface.normalAxis || 0) + side * probeOffset : axis;
  return pointInsideBounds(x, z, bounds, 0.025);
}

function isProtectedBoundarySurface(surface = {}, bounds = {}) {
  const threshold = 0.14;
  const normalAxis = Number(surface.normalAxis || 0);
  if (surface.orientation === 'x') {
    return Math.abs(normalAxis - Number(bounds.minZ || 0)) <= threshold
      || Math.abs(normalAxis - Number(bounds.maxZ || 0)) <= threshold;
  }
  return Math.abs(normalAxis - Number(bounds.minX || 0)) <= threshold
    || Math.abs(normalAxis - Number(bounds.maxX || 0)) <= threshold;
}

function protectedObjectOutsideSide(surface = {}) {
  const bounds = surface?.protectedBounds;
  if (!bounds) return null;
  const center = surface.orientation === 'x'
    ? (Number(bounds.minZ || 0) + Number(bounds.maxZ || 0)) / 2
    : (Number(bounds.minX || 0) + Number(bounds.maxX || 0)) / 2;
  return Number(surface.normalAxis || 0) >= center ? 1 : -1;
}

function safeObjectWallSide(surface = {}, axis = 0, requestedSide = 1) {
  const outsideSide = protectedObjectOutsideSide(surface);
  if (outsideSide) return outsideSide;
  return Number(requestedSide || 1) >= 0 ? 1 : -1;
}

function pointInsideBounds(x, z, bounds = {}, inset = 0) {
  return x > Number(bounds.minX || 0) + inset
    && x < Number(bounds.maxX || 0) - inset
    && z > Number(bounds.minZ || 0) + inset
    && z < Number(bounds.maxZ || 0) - inset;
}

function wallSurfaceCandidate(item, id, centerX, centerZ, rotation = 0) {
  if (!isObjectWallSurfaceCandidate(item)) return null;
  const size = itemDefaultSize(item);
  const width = Number(size[0] || 0.6);
  const depth = Number(size[2] || 0.06);
  const longAxisIsX = width >= depth;
  const angle = (Number(rotation || 0) * Math.PI) / 180;
  const vector = longAxisIsX
    ? { x: Math.cos(angle), z: Math.sin(angle) }
    : { x: -Math.sin(angle), z: Math.cos(angle) };
  const orientation = Math.abs(vector.x) >= Math.abs(vector.z) ? 'x' : 'z';
  const length = Math.max(width, depth);
  const surface = {
    id: `object-wall:${id}`,
    orientation,
    centerX: Number(centerX || 0),
    centerZ: Number(centerZ || 0),
    length,
  };
  return {
    ...surface,
    centerAxis: orientation === 'x' ? surface.centerX : surface.centerZ,
    normalAxis: orientation === 'x' ? surface.centerZ : surface.centerX,
  };
}

function isObjectWallSurfaceCandidate(item) {
  const label = `${item?.type || ''} ${item?.label || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const size = itemDefaultSize(item);
  const looksLikePartition = Number(size[1] || 0) >= 1.8 && Math.min(Number(size[0] || 0), Number(size[2] || 0)) <= 0.18;
  return label.includes('cloison') || looksLikePartition;
}

function rotatePoint(x, z, degrees = 0) {
  const radians = (Number(degrees || 0) * Math.PI) / 180;
  return {
    x: Math.cos(radians) * x - Math.sin(radians) * z,
    z: Math.sin(radians) * x + Math.cos(radians) * z,
  };
}

function objectWallSurfaceForItem(item, items = []) {
  if (!isObjectWallId(item?.wall)) return null;
  return objectWallSurfaces(items).find((surface) => surface.id === item.wall) || item.wallSurface || null;
}

function isObjectWallId(wall) {
  return String(wall || '').startsWith('object-wall:');
}

function applyPlacementRule(item, width, depth, layout) {
  const rule = normalizePlacementRule(item?.placementRule);
  if (!rule?.locked) return item;

  const bounds = itemGroupBounds({ ...item, placementRule: null, lockedPlacement: false });
  const clearance = wallThickness;
  const sideClearance = placementRuleSideClearance(item);
  const backClearance = clearance + (isSmclPartitionHeadItem(item) ? partitionHeadBackInset : 0);
  const base = {
    ...item,
    placementRule: rule,
    lockedPlacement: true,
    rotation: Number(rule.rotation || 0),
  };

  if (rule.id === 'back-right' || rule.id === 'outer-right') {
    return {
      ...base,
      x: Number((width / 2 - sideClearance - bounds.maxX).toFixed(2)),
      z: Number((-depth / 2 + backClearance - bounds.minZ).toFixed(2)),
    };
  }

  if (rule.id === 'back-center') {
    return {
      ...base,
      x: Number((-(bounds.minX + bounds.maxX) / 2).toFixed(2)),
      z: Number((-depth / 2 + backClearance - bounds.minZ).toFixed(2)),
    };
  }

  if (rule.id === 'front-left') {
    return {
      ...base,
      x: Number((-width / 2 + sideClearance - bounds.minX).toFixed(2)),
      z: Number((depth / 2 - clearance - bounds.maxZ).toFixed(2)),
    };
  }

  if (rule.id === 'front-right') {
    return {
      ...base,
      x: Number((width / 2 - sideClearance - bounds.maxX).toFixed(2)),
      z: Number((depth / 2 - clearance - bounds.maxZ).toFixed(2)),
    };
  }

  return {
    ...base,
    x: Number((-width / 2 + sideClearance - bounds.minX).toFixed(2)),
    z: Number((-depth / 2 + backClearance - bounds.minZ).toFixed(2)),
  };
}


function placementRuleSideClearance(item = {}) {
  if (isSmclPartitionHeadItem(item)) return 0;
  return wallThickness + (isPartitionHeadItem(item) ? partitionHeadEdgeInset : 0);
}

function applyWallPlacementRule(item, width, depth, layout) {
  const rule = normalizePlacementRule(item?.placementRule);
  if (!rule?.locked) return item;

  const validWalls = availableWalls(layout).map((wall) => wall.id);
  const sideWall = (rule.id === 'front-left' || rule.id === 'outer-left')
    ? 'left'
    : (rule.id === 'front-right' || rule.id === 'outer-right')
      ? 'right'
      : null;
  const wall = sideWall && validWalls.includes(sideWall) ? sideWall : 'back';
  const range = wallItemAxisRange(item, wall, width, depth);
  const axisByRule = {
    'back-left': range.min,
    'back-right': range.max,
    'back-center': (range.min + range.max) / 2,
    'front-left': wall === 'left' ? range.max : range.min,
    'front-right': wall === 'right' ? range.max : range.max,
    'outer-left': wall === 'left' ? range.max : range.min,
    'outer-right': wall === 'right' ? range.max : range.max,
  };
  const rawAxis = axisByRule[rule.id] ?? range.min;
  const axis = smclPartitionHeadWallAxis(item, wall, rawAxis, range);

  return {
    ...item,
    placementRule: rule,
    lockedPlacement: true,
    wall,
    x: Number(axis.toFixed(2)),
    y: wallItemCenterY(item),
    z: wall === 'back' ? -depth / 2 + wallThickness : Number(axis.toFixed(2)),
    wallSide: null,
    wallSurface: null,
  };
}

function smclPartitionHeadWallAxis(item, wall, rawAxis, range) {
  if (!isSmclPartitionHeadItem(item)) return snapWallAxis(rawAxis);
  const axis = Number(rawAxis || 0);
  const middle = (Number(range.min || 0) + Number(range.max || 0)) / 2;
  if (wall === 'back') {
    const side = item?.dimensions?.smclHeadSide || item?.options?.partitionHeadSide || smclPartitionHeadSide(item);
    const direction = side === 'right' ? -1 : 1;
    return clamp(Number((axis + direction * partitionHeadWallAxisInset).toFixed(2)), range.min, range.max);
  }
  const direction = axis >= middle ? -1 : 1;
  return clamp(Number((axis + direction * partitionHeadWallAxisInset).toFixed(2)), range.min, range.max);
}

function constrainItem(item, width, depth, layout, carpetFootprintEnabled = true) {
  if (isWallItem(item)) {
    if (isObjectWallId(item.wall)) {
      const surface = item.wallSurface;
      if (surface) {
        const axisForSide = Number(item.x || surface.centerAxis || 0);
        const side = safeObjectWallSide(surface, axisForSide, Number(item.wallSide || 1));
        if (!side) {
          return constrainItem({ ...item, wall: 'back', wallSide: null, wallSurface: null }, width, depth, layout, carpetFootprintEnabled);
        }
        const halfLength = surface.length / 2;
        const itemHalfWidth = wallItemMetrics(item, [], width, depth).width / 2;
        const margin = Math.min(itemHalfWidth, Math.max(0, halfLength - 0.02));
        const min = surface.centerAxis - halfLength + margin;
        const max = surface.centerAxis + halfLength - margin;
        return { ...item, x: clamp(snapWallAxis(item.x), min, max), y: wallItemCenterY(item), wallSide: side };
      }
    }

    const validWalls = availableWalls(layout).map((wall) => wall.id);
    const wall = validWalls.includes(item.wall) ? item.wall : 'back';
    if (isLockedPlacementRule(item.placementRule)) {
      return applyWallPlacementRule({ ...item, wall }, width, depth, layout);
    }
    const range = wallItemAxisRange(item, wall, width, depth);
    const axis = clamp(snapWallAxis(item.x), range.min, range.max);
    return { ...item, wall, x: axis, y: wallItemCenterY(item), z: wall === 'back' ? -depth / 2 + wallThickness : axis };
  }

  const positionedItem = applyPlacementRule(item, width, depth, layout);
  if (isSmclPartitionHeadItem(positionedItem) && itemPlacementLocked(positionedItem)) {
    return { ...positionedItem, y: floorItemBaseY(positionedItem) };
  }
  const bounds = itemPlacementBounds(positionedItem);
  const placement = closestPlacementInRegions(positionedItem, placementRegions(width, depth, layout, bounds, carpetFootprintEnabled && !isCeilingMountedItem(positionedItem)));

  if (isCeilingMountedItem(positionedItem)) {
    const sb = standFloorBounds(width, depth, layout);
    const xMin = sb.minX - bounds.minX;
    const xMax = sb.maxX - bounds.maxX;
    const zMin = sb.minZ - bounds.minZ;
    const zMax = sb.maxZ - bounds.maxZ;
    return {
      ...positionedItem,
      x: clamp(placement.x, Math.min(xMin, xMax), Math.max(xMin, xMax)),
      y: floorItemBaseY(positionedItem),
      z: clamp(placement.z, Math.min(zMin, zMax), Math.max(zMin, zMax)),
    };
  }

  return {
    ...positionedItem,
    x: placement.x,
    y: floorItemBaseY(positionedItem),
    z: placement.z,
  };
}

function updateSceneItemWithCollision(items, id, patch, width, depth, layout, carpetFootprintEnabled = true) {
  const currentItem = items.find((item) => item.id === id);
  if (!currentItem) return items;

  const editableItem = releasePlacementRuleForManualEdit(currentItem, patch);
  const candidate = constrainItem({ ...editableItem, ...patch }, width, depth, layout, carpetFootprintEnabled);
  const positionKeys = ['x', 'z', 'wall', 'wallSide', 'wallSurface', 'rotation'];
  const isPositionPatch = positionKeys.some((key) => hasOwn(patch, key));
  if (isPositionPatch && collidesWithScene(candidate, items, id, width, depth)) return items;
  return items.map((item) => (item.id === id ? candidate : item));
}

function releasePlacementRuleForManualEdit(item = {}, patch = {}) {
  const transformKeys = ['x', 'z', 'wall', 'wallSide', 'wallSurface', 'rotation'];
  const isTransformEdit = transformKeys.some((key) => hasOwn(patch, key));
  if (!isTransformEdit || itemMovementLocked(item)) return item;
  if (!item.placementRule && !item.lockedPlacement) return item;
  return { ...item, placementRule: null, lockedPlacement: false };
}

function placeItemInFreeSpot(item, items, width, depth, layout, carpetFootprintEnabled = true) {
  const firstCandidate = constrainItem(item, width, depth, layout, carpetFootprintEnabled);
  if (isWallItem(firstCandidate)) return placeWallItemInFreeSpot(firstCandidate, items, width, depth, layout);
  if (itemPlacementLocked(firstCandidate)) return collidesWithScene(firstCandidate, items, firstCandidate.id, width, depth) ? null : firstCandidate;
  if (!collidesWithScene(firstCandidate, items, firstCandidate.id, width, depth)) return firstCandidate;

  const bounds = itemPlacementBounds(firstCandidate);
  const regions = placementRegions(width, depth, layout, bounds, carpetFootprintEnabled && !isCeilingMountedItem(firstCandidate));
  const candidates = [];

  for (const region of regions) {
    for (let z = region.minZ; z <= region.maxZ + 0.001; z += collisionPlacementStep) {
      for (let x = region.minX; x <= region.maxX + 0.001; x += collisionPlacementStep) {
        candidates.push({
          x: Number(x.toFixed(2)),
          z: Number(z.toFixed(2)),
          distance: Math.hypot(x - firstCandidate.x, z - firstCandidate.z),
        });
      }
    }
  }

  for (const position of candidates.sort((a, b) => a.distance - b.distance)) {
    const candidate = constrainItem({ ...firstCandidate, x: position.x, z: position.z }, width, depth, layout, carpetFootprintEnabled);
    if (!collidesWithScene(candidate, items, candidate.id, width, depth)) return candidate;
  }

  return null;
}

function placeWallItemInFreeSpot(item, items, width, depth, layout) {
  if (!collidesWithScene(item, items, item.id, width, depth)) return item;

  const validWalls = availableWalls(layout).map((wall) => wall.id);
  const preferredWall = validWalls.includes(item.wall) ? item.wall : 'back';
  const orderedWalls = [preferredWall, ...validWalls.filter((wall) => wall !== preferredWall)];
  const candidates = [];

  orderedWalls.forEach((wall, wallIndex) => {
    const range = wallItemAxisRange(item, wall, width, depth);
    for (let axis = range.min; axis <= range.max + 0.001; axis += wallItemSnap) {
      candidates.push({
        wall,
        axis: snapWallAxis(axis),
        distance: wallIndex * 100 + Math.abs(axis - Number(item.x || 0)),
      });
    }
  });

  for (const position of candidates.sort((a, b) => a.distance - b.distance)) {
    const candidate = constrainItem({ ...item, wall: position.wall, x: position.axis }, width, depth, layout);
    if (!collidesWithScene(candidate, items, candidate.id, width, depth)) return candidate;
  }

  return null;
}

function collidesWithScene(candidate, items, ignoreId = null, width = 0, depth = 0) {
  if (!isWallItem(candidate) && collidesWithReserveProtectedArea(candidate, items, ignoreId)) return true;
  if (!itemCollisionEnabled(candidate)) return false;
  if (isWallItem(candidate)) return collidesWithWallItems(candidate, items, ignoreId, width, depth);
  const candidateBox = itemCollisionBox(candidate);
  if (!candidateBox) return false;

  return (items || []).some((item) => {
    if (!item || item.id === ignoreId || isWallItem(item) || !itemCollisionEnabled(item)) return false;
    const itemBox = itemCollisionBox(item);
    return itemBox ? boxesOverlap(candidateBox, itemBox) : false;
  });
}

function collidesWithWallItems(candidate, items, ignoreId = null, width = 0, depth = 0) {
  if (!itemCollisionEnabled(candidate)) return false;
  const candidateBox = wallItemCollisionBox(candidate, items, width, depth);
  if (!candidateBox) return false;

  return (items || []).some((item) => {
    if (!item || item.id === ignoreId || !itemCollisionEnabled(item)) return false;
    const itemBox = isWallItem(item)
      ? wallItemCollisionBox(item, items, width, depth)
      : floorItemWallCollisionBox(item, candidateBox.wall, width, depth);
    return itemBox ? wallBoxesOverlap(candidateBox, itemBox) : false;
  });
}

function collidesWithReserveProtectedArea(candidate, items = [], ignoreId = null) {
  const candidateBox = itemHardCollisionBox(candidate);
  if (!candidateBox) return false;
  return (items || []).some((item) => {
    if (!item || item.id === ignoreId || !isReserveSceneItem(item)) return false;
    const reserveBox = itemHardCollisionBox(item);
    return reserveBox ? boxesOverlap(candidateBox, reserveBox) : false;
  });
}

function wallItemCollisionBox(item, items, width, depth) {
  if (!isWallItem(item) || !itemCollisionEnabled(item)) return null;
  const metrics = wallItemMetrics(item, items, width, depth);
  const region = isPosterItem(item) ? posterSurfaceRegion(item, items, width, depth) : null;
  const axis = Number(region?.center ?? item.x ?? 0);
  const y = wallItemCenterY(item);
  return {
    wall: item.wall || 'back',
    minAxis: axis - metrics.width / 2 - collisionPadding,
    maxAxis: axis + metrics.width / 2 + collisionPadding,
    minY: y - metrics.height / 2 - collisionPadding,
    maxY: y + metrics.height / 2 + collisionPadding,
  };
}

function wallItemMetrics(item, items, width, depth) {
  if (isPosterItem(item)) {
    const region = posterSurfaceRegion(item, items, width, depth);
    return {
      width: region.width,
      height: region.height,
    };
  }
  if (item.modelUrl) {
    const size = itemGroupSize(item);
    return {
      width: Number(size.width || 0.95),
      height: Number(size.height || 0.58),
    };
  }
  return { width: 0.95, height: 0.58 };
}

function wallBoxesOverlap(a, b) {
  return a.wall === b.wall && a.minAxis < b.maxAxis && a.maxAxis > b.minAxis && a.minY < b.maxY && a.maxY > b.minY;
}

function floorItemWallCollisionBox(item, wall, width, depth) {
  const blocker = isReserveSceneItem(item)
    ? reserveWallBlocker(item, wall, width, depth, collisionPadding)
    : floorWallBlocker(item, wall, width, depth);
  if (!blocker) return null;
  const bounds = itemGroupBounds(item);
  return {
    wall,
    minAxis: blocker.min,
    maxAxis: blocker.max,
    minY: 0,
    maxY: Number(bounds.height || fixedWallHeight) + collisionPadding,
  };
}

function itemCollisionBox(item) {
  if (!item || isWallItem(item) || !itemCollisionEnabled(item)) return null;
  return itemHardCollisionBox(item, collisionPadding);
}

function itemHardCollisionBox(item, padding = collisionPadding) {
  if (!item || isWallItem(item)) return null;
  const bounds = itemPlacementBounds(item);
  const centerX = Number(item.x || 0);
  const centerZ = Number(item.z || 0);

  return {
    minX: centerX + bounds.minX - padding,
    maxX: centerX + bounds.maxX + padding,
    minZ: centerZ + bounds.minZ - padding,
    maxZ: centerZ + bounds.maxZ + padding,
  };
}

function itemPlacementBounds(item) {
  const bounds = itemGroupBounds(item);
  const corners = [
    rotatePoint(bounds.minX, bounds.minZ, Number(item.rotation || 0)),
    rotatePoint(bounds.minX, bounds.maxZ, Number(item.rotation || 0)),
    rotatePoint(bounds.maxX, bounds.minZ, Number(item.rotation || 0)),
    rotatePoint(bounds.maxX, bounds.maxZ, Number(item.rotation || 0)),
  ];
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minZ: Math.min(...corners.map((corner) => corner.z)),
    maxZ: Math.max(...corners.map((corner) => corner.z)),
  };
}

function boxesOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function itemGroupSize(item) {
  const bounds = itemGroupBounds(item);
  return {
    width: bounds.width,
    height: bounds.height,
    depth: bounds.depth,
  };
}

function itemGroupBounds(item) {
  const centeredBounds = (size = [0.7, 0.7, 0.7]) => {
    const width = Number(size[0]) || 0.7;
    const height = Number(size[1]) || 0.7;
    const depth = Number(size[2]) || 0.7;
    return {
      minX: -width / 2,
      maxX: width / 2,
      minZ: -depth / 2,
      maxZ: depth / 2,
      centerX: 0,
      centerZ: 0,
      width,
      height,
      depth,
    };
  };

  if (!item.isGroup || !item.children?.length) {
    if (isCeilingMountedItem(item)) {
      const size = itemDefaultSize(item);
      const d = Number(size?.[2] || 0.7);
      return centeredBounds([0.6, 0.05, d]);
    }
    const b = itemPlacementBoundsOverride(item) || centeredBounds(itemDefaultSize(item));
    if (item?.dimensions?.depthLocked6cm) {
      const clampedMaxZ = b.minZ + wallThickness;
      return { ...b, maxZ: clampedMaxZ, depth: wallThickness };
    }
    return b;
  }

  if (item.groupSize?.length >= 3) {
    const childBounds = item.children?.length ? childrenBounds(item.children) : null;
    if (childBounds) return childBounds;
    return centeredBounds(item.groupSize);
  }

  return childrenBounds(item.children) || centeredBounds();
}

function itemPlacementBoundsOverride(item) {
  const smclBounds = smclPartitionHeadPlacementBounds(item);
  if (smclBounds) return smclBounds;

  const bounds = item?.dimensions?.placementBounds;
  const minX = Number(bounds?.minX);
  const maxX = Number(bounds?.maxX);
  const minZ = Number(bounds?.minZ);
  const maxZ = Number(bounds?.maxZ);
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) return null;

  const width = maxX - minX;
  const depth = maxZ - minZ;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: minX + width / 2,
    centerZ: minZ + depth / 2,
    width,
    depth,
    height: Number(bounds?.height || itemDefaultSize(item)?.[1] || 0.7),
  };
}

function smclPartitionHeadPlacementBounds(item = {}) {
  if (!isSmclPartitionHeadItem(item)) return null;
  const savedBounds = item?.dimensions?.placementBounds;
  if (savedBounds?.source === 'legacy-smcl-head') return null;
  const side = item?.dimensions?.smclHeadSide || smclPartitionHeadSide(item);
  const common = { minX: -0.3, maxX: 0.3, minZ: -0.0205, maxZ: 0.0205, depth: 0.041, width: 0.6, height: 2.4, centerX: 0, centerZ: 0, source: 'smcl-head-fallback' };
  if (side === 'right') return common;
  return common;
}

function itemDefaultSize(item) {
  const savedSize = item?.dimensions?.size || item?.dimensions?.dimensions || item?.dimensions?.modelSize;
  if (item?.dimensions?.sizeSource === 'manual' && Array.isArray(savedSize) && savedSize.length >= 3) return normalizeModelSize(savedSize);
  if (Array.isArray(savedSize) && savedSize.length >= 3) return normalizeModelSize(savedSize);
  if (item?.modelSize?.length >= 3) {
    const normalizedSize = normalizeModelSize(item.modelSize);
    const looksLikeOldFallback = item?.type?.startsWith?.('asset-') && normalizedSize.every((value) => value === 1);
    if (!looksLikeOldFallback) return normalizedSize;
  }

  const defaults = {
    chair: [0.52, 0.86, 0.5],
    table: [0.96, 0.62, 0.96],
    counter: [1.15, 1.01, 0.5],
  };
  return defaults[item?.type] || inferredAssetModelSize(item);
}

function childrenBounds(children) {
  if (!children?.length) return null;
  const bounds = children.reduce((acc, child) => {
    const childBounds = itemPlacementBoundsOverride(child) || itemGroupBounds({ ...child, isGroup: false });
    const corners = [
      rotatePoint(childBounds.minX, childBounds.minZ, Number(child.rotation || 0)),
      rotatePoint(childBounds.minX, childBounds.maxZ, Number(child.rotation || 0)),
      rotatePoint(childBounds.maxX, childBounds.minZ, Number(child.rotation || 0)),
      rotatePoint(childBounds.maxX, childBounds.maxZ, Number(child.rotation || 0)),
    ];
    const minX = Math.min(...corners.map((corner) => Number(child.x || 0) + corner.x));
    const maxX = Math.max(...corners.map((corner) => Number(child.x || 0) + corner.x));
    const minZ = Math.min(...corners.map((corner) => Number(child.z || 0) + corner.z));
    const maxZ = Math.max(...corners.map((corner) => Number(child.z || 0) + corner.z));
    return {
      minX: Math.min(acc.minX, minX),
      maxX: Math.max(acc.maxX, maxX),
      minZ: Math.min(acc.minZ, minZ),
      maxZ: Math.max(acc.maxZ, maxZ),
      height: Math.max(acc.height, childBounds.height || 0.7),
    };
  }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0.7 });

  const width = Math.max(0.7, bounds.maxX - bounds.minX);
  const depth = Math.max(0.7, bounds.maxZ - bounds.minZ);
  return {
    ...bounds,
    centerX: bounds.minX + width / 2,
    centerZ: bounds.minZ + depth / 2,
    width,
    depth,
    height: bounds.height,
  };
}

function objectWallTransform(item, items = []) {
  const surface = objectWallSurfaceForItem(item, items);
  if (!surface) return null;
  const screenOffset = wallMountedNormalOffset(item, true);
  const region = isPosterItem(item) ? posterObjectSurfaceRegion(item, surface) : null;
  const axis = Number(region?.center ?? item.x ?? surface.centerAxis ?? 0);
  const side = safeObjectWallSide(surface, axis, Number(item.wallSide || 1)) || 1;
  const y = wallItemCenterY(item);
  const position = surface.orientation === 'x'
    ? [axis, y, Number(surface.normalAxis || 0) + side * screenOffset]
    : [Number(surface.normalAxis || 0) + side * screenOffset, y, axis];
  const rotation = surface.orientation === 'x'
    ? (side >= 0 ? 0 : Math.PI)
    : (side >= 0 ? Math.PI / 2 : -Math.PI / 2);
  return { position, rotation, surface };
}

function screenWorldPosition(item, width, depth, items = []) {
  const objectTransform = objectWallTransform(item, items);
  if (objectTransform) return objectTransform.position;
  const screenOffset = wallMountedNormalOffset(item, false);
  const y = wallItemCenterY(item);
  const axis = isPosterItem(item) ? posterSurfaceRegion(item, items, width, depth).center : Number(item.x || 0);
  if (item.wall === 'left') return [-width / 2 + screenOffset, y, axis];
  if (item.wall === 'right') return [width / 2 - screenOffset, y, axis];
  return [axis, y, -depth / 2 + screenOffset];
}

function wallItemCenterY(item) {
  if (isTelevisionItem(item)) return screenCenterHeight;
  if (isPosterItem(item)) return screenCenterHeight;
  if (isLedRailEntry(item)) return ledRailCenterY(item);
  if (isPartitionHeadItem(item)) return 0;
  const y = Number(item?.dimensions?.wallY);
  return Number.isFinite(y) && y >= 0 ? y : 0;
}

function wallMountedNormalOffset(item, objectSurface = false) {
  if (isPosterItem(item)) return (objectSurface ? wallThickness / 2 : wallThickness) + 0.006;
  if (item?.type === 'screen') return wallThickness + screenDepth / 2;
  if (isPartitionHeadItem(item)) {
    const bounds = itemGroupBounds(item);
    return wallThickness + partitionHeadWallGap - Number(bounds.minZ || 0);
  }
  const depth = Number(itemGroupSize(item)?.depth || item?.wallDepth || itemDefaultSize(item)?.[2] || 0.08);
  return wallThickness + Math.max(0.02, depth / 2);
}

function posterObjectSurfaceRegion(item, surface) {
  const min = Number(surface.centerAxis || 0) - Number(surface.length || 0) / 2;
  const max = Number(surface.centerAxis || 0) + Number(surface.length || 0) / 2;
  const half = 0.5;
  const axisMin = min + half;
  const axisMax = max - half;
  const center = axisMax >= axisMin ? clamp(Number(item.x ?? surface.centerAxis ?? 0), axisMin, axisMax) : Number(surface.centerAxis || 0);
  return {
    min: center - half,
    max: center + half,
    center: Number(center.toFixed(2)),
    width: 1,
    height: 1,
  };
}

function posterSurfaceRegion(item, items, width, depth) {
  if (isObjectWallId(item?.wall)) {
    const surface = objectWallSurfaceForItem(item, items) || item.wallSurface;
    if (surface) return posterObjectSurfaceRegion(item, surface);
  }

  const wall = item.wall || 'back';
  const wallLength = wall === 'back' ? width : depth;
  const min = -wallLength / 2 + 0.5;
  const max = wallLength / 2 - 0.5;
  const center = max >= min ? clamp(Number(item.x || 0), min, max) : 0;
  return {
    min: center - 0.5,
    max: center + 0.5,
    center: Number(center.toFixed(2)),
    width: 1,
    height: 1,
  };
}

function posterAvailableWidth(item, items, width, depth) {
  return posterSurfaceRegion(item, items, width, depth).width;
}

function wallBlockers(currentItem, items, width, depth, wall) {
  const margin = isPosterItem(currentItem) ? 0 : 0.1;
  return (items || [])
    .filter((item) => item.id !== currentItem.id)
    .filter((item) => !isPosterItem(currentItem) || isPosterBlockingItem(item))
    .flatMap((item) => {
      if (isWallItem(item)) return wallMountedBlocker(item, wall, width, depth, margin);
      if (isReserveSceneItem(item)) return reserveWallBlocker(item, wall, width, depth, Math.max(margin, 0.03));
      if (item.isGroup && item.children?.length) return groupChildrenWallBlockers(item, wall, width, depth, margin);
      return floorWallBlocker(item, wall, width, depth, margin);
    })
    .filter(Boolean);
}

// Expands a non-reserve group into its children and computes per-child blockers
// so that e.g. a door inside a reserve/partition group is handled correctly.
function groupChildrenWallBlockers(group, wall, width, depth, margin) {
  const groupRotation = Number(group.rotation || 0);
  return group.children.flatMap((child) => {
    const rotated = rotatePoint(Number(child.x || 0), Number(child.z || 0), groupRotation);
    const worldItem = {
      ...child,
      x: Number(group.x || 0) + rotated.x,
      z: Number(group.z || 0) + rotated.z,
      rotation: groupRotation + Number(child.rotation || 0),
    };
    return floorWallBlocker(worldItem, wall, width, depth, margin);
  });
}


function wallMountedBlocker(item, wall, width, depth, margin = 0.1) {
  if (!itemCollisionEnabled(item)) return null;
  const coverBlocker = wallCoverPartitionHeadBlocker(item, wall, width, depth, margin);
  if (coverBlocker) return coverBlocker;
  if ((item.wall || 'back') !== wall) return null;
  const axis = Number(item.x || 0);
  const itemWidth = wallItemMetrics(item, [], width, depth).width;
  return { min: axis - itemWidth / 2 - margin, max: axis + itemWidth / 2 + margin };
}

function wallCoverPartitionHeadBlocker(item, wall, width, depth, margin = 0.1) {
  if (margin !== 0 || !isSmclPartitionHeadItem(item)) return null;
  const coverWidth = Number(smclPartitionHeadPlacementBounds(item)?.width || partitionHeadWallCoverWidth);
  const halfWidth = coverWidth / 2;
  const itemWall = item.wall || 'back';
  const side = smclPartitionHeadSide(item);
  if (itemWall === wall) {
    const axis = Number(item.x || 0);
    return { min: axis - halfWidth, max: axis + halfWidth };
  }
  if (wall === 'back') {
    if (itemWall === 'left' || side === 'left') return { min: -width / 2, max: -width / 2 + coverWidth };
    if (itemWall === 'right' || side === 'right') return { min: width / 2 - coverWidth, max: width / 2 };
  }
  if (wall === 'left' && (itemWall === 'left' || side === 'left')) return { min: depth / 2 - coverWidth, max: depth / 2 };
  if (wall === 'right' && (itemWall === 'right' || side === 'right')) return { min: depth / 2 - coverWidth, max: depth / 2 };
  return null;
}

function floorWallBlocker(item, wall, width, depth, margin = 0.1) {
  const bounds = itemCollisionBox(item);
  if (!bounds) return null;
  const minX = bounds.minX;
  const maxX = bounds.maxX;
  const minZ = bounds.minZ;
  const maxZ = bounds.maxZ;
  const wallZone = 0.72;

  if (wall === 'back' && minZ <= -depth / 2 + wallZone) return { min: minX - margin, max: maxX + margin };
  if (wall === 'left' && minX <= -width / 2 + wallZone) return { min: minZ - margin, max: maxZ + margin };
  if (wall === 'right' && maxX >= width / 2 - wallZone) return { min: minZ - margin, max: maxZ + margin };
  return null;
}

function reserveWallBlocker(item, wall, width, depth, margin = 0.03) {
  const bounds = itemHardCollisionBox(item, 0);
  if (!bounds) return null;
  const wallZone = 0.9;
  const cornerZone = 0.9;
  const limits = wallAxisLimits(wall, width, depth);
  let blocker = null;

  if (wall === 'back' && bounds.minZ <= -depth / 2 + wallZone) {
    blocker = { min: bounds.minX - margin, max: bounds.maxX + margin };
    if (bounds.minX <= -width / 2 + cornerZone) blocker.min = limits.min;
    if (bounds.maxX >= width / 2 - cornerZone) blocker.max = limits.max;
  }

  if (wall === 'left' && bounds.minX <= -width / 2 + wallZone) {
    blocker = { min: bounds.minZ - margin, max: bounds.maxZ + margin };
    if (bounds.minZ <= -depth / 2 + cornerZone) blocker.min = limits.min;
    if (bounds.maxZ >= depth / 2 - cornerZone) blocker.max = limits.max;
  }

  if (wall === 'right' && bounds.maxX >= width / 2 - wallZone) {
    blocker = { min: bounds.minZ - margin, max: bounds.maxZ + margin };
    if (bounds.minZ <= -depth / 2 + cornerZone) blocker.min = limits.min;
    if (bounds.maxZ >= depth / 2 - cornerZone) blocker.max = limits.max;
  }

  if (!blocker) return null;
  return {
    min: clamp(blocker.min, limits.min, limits.max),
    max: clamp(blocker.max, limits.min, limits.max),
  };
}

function StandScene({ width, depth, height, layout, items, selectedId, setSelectedId, draggingId, setDraggingId, onDragMove, viewAngle, carpetColor, carpetFootprintColor, carpetFootprintEnabled = true, wallFabricColor, reserveWallFabricColor = null, wallCovers = {}, technicalFloor = null, technicalFloorTrimType = 'straight', technicalFloorRampX = 0, onTechnicalFloorRampX, onTechnicalFloorRampDragChange, interactive = true, hoverEnabled = true, canEditLockedItems = false, visualContext = null }) {
  const [hoveredId, setHoveredId] = useState(null);
  const draggingItem = useMemo(() => items.find((item) => item.id === draggingId) || null, [items, draggingId]);
  const cameraPivot = useMemo(() => {
    const radians = (viewAngle * Math.PI) / 180;
    return [Math.sin(radians) * 0.75, 0, Math.cos(radians) * 0.25];
  }, [viewAngle]);

  const dragFromPointer = (event) => {
    if (!interactive || !draggingId) return;
    const floorPoint = new Vector3();
    event.ray.intersectPlane(floorPlane, floorPoint);
    event.stopPropagation();
    onDragMove({
      x: floorPoint.x - cameraPivot[0],
      z: floorPoint.z - cameraPivot[2],
    });
  };

  const setItemHover = (itemId, hovered) => {
    if (!interactive || !hoverEnabled || draggingId) return;
    setHoveredId((current) => (hovered ? itemId : (current === itemId ? null : current)));
  };

  const clearSceneSelection = () => {
    if (!interactive || draggingId) return;
    setHoveredId(null);
    setSelectedId(null);
  };

  return (
    <group position={cameraPivot} onPointerMissed={clearSceneSelection}>
      {interactive && <DragSurface width={width} depth={depth} layout={layout} carpetFootprintEnabled={carpetFootprintEnabled} sceneOffset={cameraPivot} draggingId={draggingId} draggingItem={draggingItem} onDragMove={onDragMove} onClearHover={() => setHoveredId(null)} onDeselect={clearSceneSelection} />}
      <Floor width={width} depth={depth} layout={layout} carpetColor={carpetColor} carpetFootprintColor={carpetFootprintColor} carpetFootprintEnabled={carpetFootprintEnabled} technicalFloor={technicalFloor} technicalFloorTrimType={technicalFloorTrimType} technicalFloorRampX={technicalFloorRampX} onTechnicalFloorRampX={onTechnicalFloorRampX} onTechnicalFloorRampDragChange={onTechnicalFloorRampDragChange} interactive={interactive} sceneOffset={cameraPivot} />
      <Walls width={width} depth={depth} height={height} layout={layout} items={items} wallFabricColor={wallFabricColor} reserveWallFabricColor={reserveWallFabricColor} wallCovers={wallCovers} onDeselect={clearSceneSelection} />
      <Text position={[0, 0.018, depth / 2 - 0.18]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.15} color="#6b6458">
        {width}m x {depth}m
      </Text>
      {items.map((item) => (
        <Suspense key={item.id} fallback={null}>
          <SceneItem
          item={item}
          items={items}
          width={width}
          depth={depth}
          selected={item.id === selectedId}
          hovered={item.id === hoveredId}
          dragging={item.id === draggingId}
          onSelect={() => interactive && setSelectedId(item.id)}
          onHover={hoverEnabled ? ((hovered) => setItemHover(item.id, hovered)) : null}
          onDragStart={(event) => {
            event.stopPropagation();
            if (!interactive) return;
            setSelectedId(item.id);
            if (!canEditLockedItems && itemMovementLocked(item)) return;
            event.target.setPointerCapture(event.pointerId);
            setDraggingId(item.id);
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            if (draggingId === item.id && event.target.hasPointerCapture?.(event.pointerId)) {
              event.target.releasePointerCapture(event.pointerId);
            }
            if (draggingId === item.id) setDraggingId(null);
          }}
            onDragMove={dragFromPointer}
            visualContext={visualContext}
          />
        </Suspense>
      ))}
      <WallCoverSurfaces width={width} depth={depth} layout={layout} items={items} covers={wallCovers} />
    </group>
  );
}

function Floor({ width, depth, layout, carpetColor, carpetFootprintColor, carpetFootprintEnabled = true, technicalFloor = null, technicalFloorTrimType = 'straight', technicalFloorRampX = 0, onTechnicalFloorRampX, onTechnicalFloorRampDragChange, interactive = true, sceneOffset = [0, 0, 0] }) {
  const footprint = rectSize(carpetFootprintBounds(width, depth, layout));
  const carpetTexture = useRepeatedTexture(colorTextureUrl(carpetColor), width, depth);
  const footprintTexture = useRepeatedTexture(colorTextureUrl(carpetFootprintColor || carpetColor), footprint.width, footprint.depth);
  const carpetHex = colorHex(carpetColor, '#bebebe');
  const footprintHex = colorHex(carpetFootprintColor || carpetColor, carpetHex);
  const slabHeight = technicalFloor?.height || floorThickness;
  const rampDimensions = technicalFloor ? technicalRampDimensions(width, slabHeight) : null;
  const rampLimit = rampDimensions ? Math.max(0, width / 2 - rampDimensions.width / 2) : 0;
  const resolvedRampX = rampDimensions ? clamp(Number(technicalFloorRampX || 0), -rampLimit, rampLimit) : 0;
  const openEdges = technicalFloor ? openTechnicalFloorEdges(layout) : [];
  const slabSegments = technicalFloor && rampDimensions
    ? technicalFloorSlabSegments(width, depth, rampDimensions, resolvedRampX, openEdges, technicalFloorTrimType === 'sloped' ? slabHeight : 0.04)
    : [{ id: 'full', width, depth, centerX: 0, centerZ: 0 }];

  return (
    <group>
      {slabSegments.map((segment) => (
        <mesh key={segment.id} receiveShadow position={[segment.centerX, -slabHeight / 2, segment.centerZ]}>
          <boxGeometry args={[segment.width, slabHeight, segment.depth]} />
          <meshStandardMaterial color={carpetTexture ? '#ffffff' : carpetHex} map={carpetTexture || null} roughness={0.88} />
        </mesh>
      ))}
      {technicalFloor && <TechnicalFloorAccessories width={width} depth={depth} layout={layout} height={slabHeight} trimType={technicalFloorTrimType} rampX={technicalFloorRampX} onRampXChange={onTechnicalFloorRampX} onRampDragChange={onTechnicalFloorRampDragChange} interactive={interactive} sceneOffset={sceneOffset} />}
      {carpetFootprintEnabled && (
        <>
          <mesh receiveShadow position={[footprint.centerX, 0.012, footprint.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[footprint.width, footprint.depth]} />
            <meshStandardMaterial color={footprintTexture ? '#ffffff' : footprintHex} map={footprintTexture || null} roughness={0.88} />
          </mesh>
        </>
      )}
    </group>
  );
}

function technicalRampDimensions(width, floorHeight) {
  const height = Math.max(0.04, Number(floorHeight || 0.04));
  return {
    depth: height <= 0.05 ? 0.7 : 1.25,
    width: Math.min(1.4, Math.max(0.9, Number(width || 0) * 0.25)),
  };
}

function technicalFloorSlabSegments(width, depth, rampDimensions, rampX = 0, edges = [], edgeInset = 0.04) {
  const rampWidth = Number(rampDimensions?.width || 0);
  const rampDepth = Number(rampDimensions?.depth || 0);
  const inset = Math.max(0, Number(edgeInset || 0));
  const minX = -width / 2 + (edges.includes('left') ? inset : 0);
  const maxX = width / 2 - (edges.includes('right') ? inset : 0);
  const minZ = -depth / 2;
  const maxZ = depth / 2 - (edges.includes('front') ? inset : 0);
  const safeWidth = Math.max(0.01, maxX - minX);
  const safeDepth = Math.max(0.01, maxZ - minZ);
  if (!rampWidth || !rampDepth) {
    return [{ id: 'inset-full', width: safeWidth, depth: safeDepth, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 }];
  }

  const rampMinX = Math.max(minX, rampX - rampWidth / 2);
  const rampMaxX = Math.min(maxX, rampX + rampWidth / 2);
  const rampBackZ = Math.max(minZ, depth / 2 - rampDepth);
  const segments = [];
  const addSegment = (id, left, right, back, front) => {
    const segmentWidth = right - left;
    const segmentDepth = front - back;
    if (segmentWidth <= 0.01 || segmentDepth <= 0.01) return;
    segments.push({
      id,
      width: segmentWidth,
      depth: segmentDepth,
      centerX: (left + right) / 2,
      centerZ: (back + front) / 2,
    });
  };

  addSegment('left', minX, rampMinX, minZ, maxZ);
  addSegment('right', rampMaxX, maxX, minZ, maxZ);
  addSegment('back', rampMinX, rampMaxX, minZ, Math.min(maxZ, rampBackZ));
  return segments.length ? segments : [{ id: 'inset-full', width: safeWidth, depth: safeDepth, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 }];
}

function TechnicalFloorAccessories({ width, depth, layout, height, trimType, rampX = 0, onRampXChange, onRampDragChange, interactive = true, sceneOffset = [0, 0, 0] }) {
  const [draggingRamp, setDraggingRamp] = useState(false);
  const edges = openTechnicalFloorEdges(layout);
  const trimHeight = Math.max(0.04, Number(height || 0.04));
  const sloped = trimType === 'sloped';
  const trimDepth = sloped ? trimHeight : 0.04;
  const { depth: rampDepth, width: rampWidth } = technicalRampDimensions(width, trimHeight);
  const rampLimit = Math.max(0, width / 2 - rampWidth / 2);
  const resolvedRampX = clamp(Number(rampX || 0), -rampLimit, rampLimit);
  const moveRamp = (event) => {
    if (!interactive || !draggingRamp || !onRampXChange) return;
    event.stopPropagation();
    const floorPoint = new Vector3();
    event.ray.intersectPlane(floorPlane, floorPoint);
    onRampXChange(clamp(floorPoint.x - sceneOffset[0], -rampLimit, rampLimit));
  };

  return (
    <group>
      {edges.includes('front') && <TechnicalTrim edge="front" width={width} depth={depth} height={trimHeight} thickness={trimDepth} sloped={sloped} gapCenter={resolvedRampX} gapWidth={sloped ? 0 : rampWidth + 0.08} hasLeftEdge={edges.includes('left')} hasRightEdge={edges.includes('right')} />}
      {edges.includes('left') && <TechnicalTrim edge="left" width={width} depth={depth} height={trimHeight} thickness={trimDepth} sloped={sloped} hasFrontEdge={edges.includes('front')} />}
      {edges.includes('right') && <TechnicalTrim edge="right" width={width} depth={depth} height={trimHeight} thickness={trimDepth} sloped={sloped} hasFrontEdge={edges.includes('front')} />}
      {!sloped && <mesh
          castShadow
          receiveShadow
          position={[resolvedRampX, -trimHeight, depth / 2 - rampDepth / 2]}
          onPointerDown={(event) => {
            if (!interactive || !onRampXChange) return;
            event.stopPropagation();
            event.target.setPointerCapture?.(event.pointerId);
            setDraggingRamp(true);
            onRampDragChange?.(true);
          }}
          onPointerMove={moveRamp}
          onPointerUp={(event) => {
            event.stopPropagation();
            event.target.releasePointerCapture?.(event.pointerId);
            setDraggingRamp(false);
            onRampDragChange?.(false);
          }}
          onPointerCancel={() => {
            setDraggingRamp(false);
            onRampDragChange?.(false);
          }}
        >
          <RampGeometry width={rampWidth} depth={rampDepth} height={trimHeight} includeBackFace={false} />
          <meshStandardMaterial color={draggingRamp ? '#b9c5d4' : '#d9dde2'} roughness={0.55} metalness={0.05} />
        </mesh>}
    </group>
  );
}

function RampGeometry({ width, depth, height, yOffset = 0.006, includeBackFace = true, includeBottomFace = true }) {
  const geometry = useMemo(() => {
    const w = Math.max(0.2, Number(width || 1));
    const d = Math.max(0.2, Number(depth || 0.8));
    const h = Math.max(0.02, Number(height || 0.04));
    const x0 = -w / 2;
    const x1 = w / 2;
    const zFront = d / 2;
    const zBack = -d / 2;
    const yLow = Number(yOffset || 0);
    const yHigh = h + Number(yOffset || 0);
    const positions = [
      // Sloped walking surface: low at the entrance, high inside the stand.
      x0, yLow, zFront, x1, yLow, zFront, x1, yHigh, zBack,
      x0, yLow, zFront, x1, yHigh, zBack, x0, yHigh, zBack,
      // Left side.
      x0, yLow, zFront, x0, yHigh, zBack, x0, yLow, zBack,
      // Right side.
      x1, yLow, zFront, x1, yLow, zBack, x1, yHigh, zBack,
    ];
    if (includeBackFace) {
      positions.push(
        x0, yLow, zBack, x1, yLow, zBack, x1, yHigh, zBack,
        x0, yLow, zBack, x1, yHigh, zBack, x0, yHigh, zBack,
      );
    }
    if (includeBottomFace) {
      positions.push(
        x0, yLow, zFront, x0, yLow, zBack, x1, yLow, zBack,
        x0, yLow, zFront, x1, yLow, zBack, x1, yLow, zFront,
      );
    }
    const rampGeometry = new BufferGeometry();
    rampGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    rampGeometry.computeVertexNormals();
    return rampGeometry;
  }, [width, depth, height, yOffset, includeBackFace, includeBottomFace]);

  return <primitive object={geometry} attach="geometry" />;
}

function TechnicalTrim({ edge, width, depth, height, thickness, sloped, gapCenter = 0, gapWidth = 0, hasFrontEdge = false, hasLeftEdge = false, hasRightEdge = false }) {
  const isFront = edge === 'front';
  const length = isFront ? width : depth;
  const materialColor = sloped ? '#c7ccd2' : '#eef1f4';

  if (sloped) {
    const slopeDepth = Math.max(0.02, Number(thickness || height || 0.04));
    const cornerInsetLeft = isFront && hasLeftEdge ? slopeDepth : 0;
    const cornerInsetRight = isFront && hasRightEdge ? slopeDepth : 0;
    const frontInset = !isFront && hasFrontEdge ? slopeDepth : 0;
    const effectiveLength = Math.max(0.02, length - cornerInsetLeft - cornerInsetRight - frontInset);
    const position = isFront
      ? [(cornerInsetLeft - cornerInsetRight) / 2, -height, depth / 2 - slopeDepth / 2]
      : [
        edge === 'left' ? -width / 2 + slopeDepth / 2 : width / 2 - slopeDepth / 2,
        -height,
        -frontInset / 2,
      ];
    const rotation = isFront ? [0, 0, 0] : [0, edge === 'left' ? -Math.PI / 2 : Math.PI / 2, 0];
    return (
      <mesh castShadow receiveShadow position={position} rotation={rotation}>
        <RampGeometry width={effectiveLength} depth={slopeDepth} height={height} yOffset={0.001} includeBackFace={false} includeBottomFace={false} />
        <meshStandardMaterial color={materialColor} roughness={0.52} metalness={0.04} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
    );
  }

  if (isFront && gapWidth > 0) {
    const gapMin = clamp(Number(gapCenter || 0) - gapWidth / 2, -width / 2, width / 2);
    const gapMax = clamp(Number(gapCenter || 0) + gapWidth / 2, -width / 2, width / 2);
    const segments = [
      { id: 'left', min: -width / 2, max: gapMin },
      { id: 'right', min: gapMax, max: width / 2 },
    ].filter((segment) => segment.max - segment.min > 0.02);

    return (
      <group>
        {segments.map((segment) => {
          const segmentLength = segment.max - segment.min;
          return (
            <mesh
              key={segment.id}
              castShadow
              receiveShadow
              position={[(segment.min + segment.max) / 2, -height / 2, depth / 2 - thickness / 2]}
            >
              <boxGeometry args={[segmentLength, height, thickness]} />
              <meshStandardMaterial color={materialColor} roughness={0.48} metalness={0.08} />
            </mesh>
          );
        })}
      </group>
    );
  }

  const position = edge === 'front'
    ? [0, -height / 2, depth / 2 - thickness / 2]
    : [edge === 'left' ? -width / 2 + thickness / 2 : width / 2 - thickness / 2, -height / 2, 0];
  const size = isFront ? [length, height, thickness] : [thickness, height, length];
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={materialColor} roughness={0.48} metalness={0.08} />
    </mesh>
  );
}

function colorHex(color, fallback = '#bebebe') {
  return typeof color === 'string' ? color : (color?.hex || fallback);
}

function colorTextureUrl(color) {
  return typeof color === 'string' ? '' : (color?.image || '');
}

function useRepeatedTexture(url, width, depth, tileSize = 1) {
  const [texture, setTexture] = useState(() => {
    const cachedImage = url ? Cache.get(`image:${url}`) : null;
    return cachedImage ? createRepeatedTextureFromImage(cachedImage, width, depth, tileSize, url) : null;
  });

  useEffect(() => {
    let disposed = false;
    let currentTexture = null;

    if (!url) {
      setTexture((previous) => {
        previous?.dispose?.();
        return null;
      });
      return undefined;
    }

    const applyImage = (image) => {
      if (disposed || !image) return;
      const seamlessTexture = createRepeatedTextureFromImage(image, width, depth, tileSize, url);
      if (seamlessTexture) {
        currentTexture = seamlessTexture;
        setTexture((previous) => {
          if (previous && previous !== seamlessTexture) previous.dispose?.();
          return seamlessTexture;
        });
      } else {
        logTextureDiagnostic('Repeated floor texture ignored after decode issue', { url });
        setTexture(null);
      }
    };

    const cachedImage = Cache.get(`image:${url}`);
    if (cachedImage) {
      applyImage(cachedImage);
    } else {
      setTexture((previous) => {
        previous?.dispose?.();
        return null;
      });
      loadDecodedImage(url).then(({ ok, image }) => {
        if (!disposed && ok) applyImage(image);
      });
    }

    return () => {
      disposed = true;
      currentTexture?.dispose?.();
    };
  }, [url, width, depth, tileSize]);

  return texture;
}

function createRepeatedTextureFromImage(image, width, depth, tileSize = 1, url = '') {
  try {
    const seamlessTexture = createSeamlessRepeatedTexture(image);
    configureRepeatedTexture(seamlessTexture, width, depth, tileSize);
    return seamlessTexture;
  } catch (error) {
    logTextureDiagnostic('Repeated texture ignored after decode issue', { url, error });
    return null;
  }
}

function configureRepeatedTexture(texture, width, depth, tileSize = 1) {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.repeat.set(Math.max(1, Number(width || 1) / tileSize), Math.max(1, Number(depth || 1) / tileSize));
  texture.needsUpdate = true;
  return texture;
}

function createSeamlessRepeatedTexture(image) {
  if (typeof document === 'undefined' || !image) return new CanvasTexture(document.createElement('canvas'));
  const imageWidth = image.naturalWidth || image.videoWidth || image.width || 1;
  const imageHeight = image.naturalHeight || image.videoHeight || image.height || 1;
  const cropX = Math.floor(imageWidth * 0.08);
  const cropY = Math.floor(imageHeight * 0.08);
  const tileWidth = Math.max(1, imageWidth - cropX * 2);
  const tileHeight = Math.max(1, imageHeight - cropY * 2);
  const canvas = document.createElement('canvas');
  canvas.width = tileWidth * 2;
  canvas.height = tileHeight * 2;
  const ctx = canvas.getContext('2d');

  // Use the image center only: the source JPG edges often contain subtle borders
  // that become visible as seams once repeated on a large floor.
  drawMirroredTile(ctx, image, 0, 0, tileWidth, tileHeight, cropX, cropY, false, false);
  drawMirroredTile(ctx, image, tileWidth, 0, tileWidth, tileHeight, cropX, cropY, true, false);
  drawMirroredTile(ctx, image, 0, tileHeight, tileWidth, tileHeight, cropX, cropY, false, true);
  drawMirroredTile(ctx, image, tileWidth, tileHeight, tileWidth, tileHeight, cropX, cropY, true, true);

  return new CanvasTexture(canvas);
}

function drawMirroredTile(ctx, image, x, y, width, height, sourceX, sourceY, flipX, flipY) {
  ctx.save();
  ctx.translate(x + (flipX ? width : 0), y + (flipY ? height : 0));
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);
  ctx.restore();
}


function DragSurface({ width, depth, layout, carpetFootprintEnabled = true, sceneOffset, draggingId, draggingItem = null, onDragMove, onClearHover, onDeselect }) {
  const footprint = rectSize(carpetFootprintBounds(width, depth, layout));
  const emitDragPoint = (event) => {
    onDragMove({
      x: event.point.x - sceneOffset[0],
      z: event.point.z - sceneOffset[2],
    });
  };
  const handleDragMove = (event) => {
    event.stopPropagation();
    if (!draggingId) {
      onClearHover?.();
      return;
    }
    emitDragPoint(event);
  };
  const dragPlane = (key, position, size, rotation = [-Math.PI / 2, 0, 0]) => (
    <mesh
      key={key}
      position={position}
      rotation={rotation}
      onPointerDown={() => {
        if (!draggingId) onDeselect?.();
      }}
      onPointerMove={handleDragMove}
      onPointerUp={(event) => {
        if (!draggingId) return;
        event.stopPropagation();
      }}
    >
      <planeGeometry args={size} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
    </mesh>
  );
  const wallDragPlanes = () => {
    if (!draggingItem || !isWallItem(draggingItem)) return null;
    const sideDepth = Math.max(0.01, depth - wallThickness);
    const sideZ = -depth / 2 + wallThickness + sideDepth / 2;
    return (
      <>
        {dragPlane('wall-back', [0, fixedWallHeight / 2, -depth / 2 + wallThickness], [width + wallSwitchZone * 2, fixedWallHeight], [0, 0, 0])}
        {(layout === 'left' || layout === 'u') && dragPlane('wall-left', [-width / 2 + wallThickness, fixedWallHeight / 2, sideZ], [sideDepth + wallSwitchZone * 2, fixedWallHeight], [0, Math.PI / 2, 0])}
        {(layout === 'right' || layout === 'u') && dragPlane('wall-right', [width / 2 - wallThickness, fixedWallHeight / 2, sideZ], [sideDepth + wallSwitchZone * 2, fixedWallHeight], [0, -Math.PI / 2, 0])}
      </>
    );
  };

  return (
    <group>
      {dragPlane('stand', [0, 0.015, 0], [width, depth])}
      {carpetFootprintEnabled && dragPlane('footprint', [footprint.centerX, 0.016, footprint.centerZ], [footprint.width, footprint.depth])}
      {wallDragPlanes()}
    </group>
  );
}


function Walls({ width, depth, height, layout, items = [], wallFabricColor, reserveWallFabricColor = null, wallCovers = {}, onDeselect }) {
  const sideDepth = Math.max(0.01, depth - wallThickness);
  const sideZ = -depth / 2 + wallThickness + sideDepth / 2;
  return (
    <group onPointerDown={() => onDeselect?.()}>
      <Wall position={[0, height / 2, -depth / 2 + wallThickness / 2]} size={[width, height, wallThickness]} />
      <WallBaseboards wall="back" width={width} depth={depth} items={items} />
      {(layout === 'left' || layout === 'u') && <Wall position={[-width / 2 + wallThickness / 2, height / 2, sideZ]} size={[wallThickness, height, sideDepth]} />}
      {(layout === 'left' || layout === 'u') && <WallBaseboards wall="left" width={width} depth={depth} items={items} />}
      {(layout === 'right' || layout === 'u') && <Wall position={[width / 2 - wallThickness / 2, height / 2, sideZ]} size={[wallThickness, height, sideDepth]} />}
      {(layout === 'right' || layout === 'u') && <WallBaseboards wall="right" width={width} depth={depth} items={items} />}
      <WallFabricSurfaces width={width} depth={depth} layout={layout} items={items} color={wallFabricColor} reserveColor={reserveWallFabricColor} />
    </group>
  );
}

function WallBaseboards({ wall, width, depth, items = [] }) {
  const y = baseboardHeight / 2;
  return (
    <>
      {wallBaseboardSegments(wall, width, depth, items).map((segment, index) => {
        const length = segment.max - segment.min;
        const center = (segment.min + segment.max) / 2;
        const position = wall === 'back'
          ? [center, y, -depth / 2 + wallThickness + baseboardThickness / 2]
          : [
              wall === 'left' ? -width / 2 + wallThickness + baseboardThickness / 2 : width / 2 - wallThickness - baseboardThickness / 2,
              y,
              center,
            ];
        const size = wall === 'back'
          ? [length, baseboardHeight, baseboardThickness]
          : [baseboardThickness, baseboardHeight, length];
        return <Baseboard key={`${wall}-baseboard-${index}`} position={position} size={size} />;
      })}
    </>
  );
}

function wallBaseboardSegments(wall, width, depth, items = []) {
  const limits = wallAxisLimits(wall, width, depth);
  const blockers = (items || [])
    .filter((item) => (isPartitionHeadItem(item) || isAutomaticPartitionHeadItem(item)) && (item.wall || 'back') === wall)
    .map((item) => wallMountedBlocker(item, wall, width, depth, 0.08))
    .filter(Boolean)
    .map((blocker) => ({ min: clamp(blocker.min, limits.min, limits.max), max: clamp(blocker.max, limits.min, limits.max) }))
    .filter((blocker) => blocker.max > blocker.min);
  return freeWallIntervals(limits, blockers).filter((segment) => segment.max - segment.min > 0.05);
}

function WallFabricSurfaces({ width, depth, layout, items = [], color, reserveColor = null }) {
  const surfaces = wallCoverSurfaceOptions(layout, width, depth, items);
  return (
    <group>
      {surfaces.map((surface) => (
        <WallFabricSurface key={`fabric-${surface.id}`} surface={surface} color={surface.kind === 'reserve' ? (reserveColor || color) : color} />
      ))}
    </group>
  );
}

function WallFabricSurface({ surface, color }) {
  const fabricHeight = Math.max(0.1, fixedWallHeight - baseboardHeight);
  const texture = useRepeatedTexture(colorTextureUrl(color), surface.width, fabricHeight, 1.8);
  const position = [surface.position[0], baseboardHeight + fabricHeight / 2, surface.position[2]];
  return (
    <group position={position} rotation={[0, surface.rotation, 0]}>
      <mesh renderOrder={1} raycast={() => null}>
        <boxGeometry args={[surface.width, fabricHeight, 0.001]} />
        <meshStandardMaterial color={texture ? '#ffffff' : colorHex(color, '#f8f7f3')} map={texture || null} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

function WallCoverSurfaces({ width, depth, layout, items = [], covers = {} }) {
  const surfaces = wallCoverSurfaceOptions(layout, width, depth, items);
  return (
    <group>
      {surfaces.flatMap((surface) => {
        const cover = covers?.[surface.id];
        if (!cover?.enabled) return [];
        return wallCoverSegmentsForSurface(surface, items, width, depth).map((segment) => (
          <WallCoverSurface key={segment.id} surface={segment} imageUrl={cover.imageUrl} />
        ));
      })}
    </group>
  );
}

function WallCoverSurface({ surface, imageUrl }) {
  const coverHeight = Math.max(0.1, Number(surface.height || fixedWallHeight) - baseboardHeight);
  const coverSurface = { ...surface, height: coverHeight };
  const texture = useExternalTexture(imageUrl || '', { coverSize: posterCoverTextureSize(coverSurface, 2048) });
  const position = [surface.position[0], baseboardHeight + coverHeight / 2, surface.position[2]];
  if (imageUrl && !texture) return null;
  return (
    <group position={position} rotation={[0, surface.rotation, 0]}>
      <mesh renderOrder={2} raycast={() => null}>
        <planeGeometry args={[surface.width, coverHeight]} />
        <meshBasicMaterial color={texture ? '#ffffff' : '#eef2f6'} map={texture || null} side={DoubleSide} toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      {!texture && (
        <Text position={[0, 0, 0.006]} fontSize={Math.min(0.18, surface.width / 10)} color="#1f4378" anchorX="center" anchorY="middle">
          VISUEL À FOURNIR
        </Text>
      )}
    </group>
  );
}

function Wall({ position, size }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#f4f2ed" roughness={0.96} metalness={0} />
    </mesh>
  );
}

function Baseboard({ position, size }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#f4efe4" roughness={0.52} />
    </mesh>
  );
}

function SceneItem({ item, items = [], selected, hovered, dragging, width, depth, onSelect, onHover, onDragStart, onDragEnd, onDragMove, visualContext }) {
  const rotationY = (item.rotation * Math.PI) / 180;
  if (isWallItem(item)) return <WallMountedItem item={item} items={items} width={width} depth={depth} selected={selected} hovered={hovered} dragging={dragging} onSelect={onSelect} onHover={onHover} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} visualContext={visualContext} />;
  if (item.isGroup) return <GroupedSceneItem item={item} selected={selected} hovered={hovered} dragging={dragging} rotationY={rotationY} onSelect={onSelect} onHover={onHover} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} visualContext={visualContext} />;
  return (
    <group
      position={[item.x, floorItemBaseY(item), item.z]}
      rotation={[0, rotationY, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerOver={onHover ? ((event) => { event.stopPropagation(); onHover(true); }) : undefined}
      onPointerOut={onHover ? ((event) => { event.stopPropagation(); onHover(false); }) : undefined}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerMove={(event) => {
        if (dragging) onDragMove(event);
      }}
    >
      <SceneItemContent item={item} selected={selected} hovered={hovered} dragging={dragging} visualContext={visualContext} />
    </group>
  );
}

function GroupedSceneItem({ item, selected, hovered, dragging, rotationY, onSelect, onHover, onDragStart, onDragEnd, onDragMove, visualContext }) {
  const groupBounds = itemGroupBounds(item);
  return (
    <group
      position={[item.x, floorItemBaseY(item), item.z]}
      rotation={[0, rotationY, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerOver={onHover ? ((event) => { event.stopPropagation(); onHover(true); }) : undefined}
      onPointerOut={onHover ? ((event) => { event.stopPropagation(); onHover(false); }) : undefined}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerMove={(event) => {
        if (dragging) onDragMove(event);
      }}
    >
      {item.children?.map((child) => (
        <group key={child.id} position={[child.x || 0, child.y || 0, child.z || 0]} rotation={[0, ((child.rotation || 0) * Math.PI) / 180, 0]}>
          <SceneItemContent item={child} selected={false} hovered={hovered} dragging={dragging} visualContext={visualContext} />
        </group>
      ))}
      {selected && <SelectionFrame bounds={groupBounds} />}
    </group>
  );
}

function CeilingItemStrip({ item, selected, hovered, dragging }) {
  const size = itemDefaultSize(item);
  const depth = Number(size?.[2] || 0.7);
  const w = 0.6;
  const h = 0.05;
  const color = item.color || '#c8c0d8';
  const bounds = { width: w, height: h, depth };
  return (
    <>
      <ObjHitbox bounds={bounds} />
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[w, h, depth]} />
        <meshStandardMaterial color={color} opacity={hovered || dragging ? 0.7 : 1} transparent={hovered || dragging} />
      </mesh>
      {selected && <SelectionFrame bounds={bounds} centerY={0} />}
    </>
  );
}

function SceneItemContent({ item, selected, hovered, dragging, visualContext }) {
  const bounds = itemGroupBounds(item);
  const centerY = isCenterAnchoredWallModel(item) ? 0 : null;
  if (isCeilingMountedItem(item)) {
    return <CeilingItemStrip item={item} selected={selected} hovered={hovered} dragging={dragging} />;
  }
  return (
    <>
      {item.type === 'chair' && <Chair selected={selected} hovered={hovered} dragging={dragging} />}
      {item.type === 'table' && <Table selected={selected} hovered={hovered} dragging={dragging} />}
      {item.type === 'counter' && <Counter selected={selected} hovered={hovered} dragging={dragging} />}
      {item.modelUrl && (
        <>
          <ObjHitbox bounds={bounds} centerY={centerY} />
          <Model3D item={item} selected={selected} hovered={hovered} dragging={dragging} visualContext={visualContext} />
          <ObjectBaseboards item={item} />
        </>
      )}
      {selected && <SelectionFrame bounds={bounds} centerY={centerY} />}
    </>
  );
}

function ObjectBaseboards({ item }) {
  if (!shouldShowObjectBaseboards(item)) return null;
  const [width, , depth] = itemDefaultSize(item);
  const y = baseboardHeight / 2 + 0.002;
  const xSize = Math.max(0.08, width);
  const zSize = Math.max(0.08, depth);
  return (
    <group>
      <Baseboard position={[0, y, zSize / 2 + baseboardThickness / 2]} size={[xSize, baseboardHeight, baseboardThickness]} />
      <Baseboard position={[0, y, -zSize / 2 - baseboardThickness / 2]} size={[xSize, baseboardHeight, baseboardThickness]} />
      <Baseboard position={[xSize / 2 + baseboardThickness / 2, y, 0]} size={[baseboardThickness, baseboardHeight, zSize]} />
      <Baseboard position={[-xSize / 2 - baseboardThickness / 2, y, 0]} size={[baseboardThickness, baseboardHeight, zSize]} />
    </group>
  );
}

function shouldShowObjectBaseboards(item) {
  const text = `${item?.type || ''} ${item?.label || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (text.includes('tete de cloison')) return false;
  return text.includes('cloison');
}

function activeColor(selected, dragging, base) {
  if (dragging) return '#f6a23a';
  return base;
}

function hoverMaterialProps(selected, hovered) {
  return hovered && !selected ? { transparent: true, opacity: 0.48, depthWrite: false } : {};
}

function SelectionFrame({ bounds = {}, centerY = null }) {
  const width = Math.max(0.08, Number(bounds.width || 0.7) + 0.045);
  const height = Math.max(0.08, Number(bounds.height || 0.7) + 0.045);
  const depth = Math.max(0.08, Number(bounds.depth || 0.7) + 0.045);
  const y = centerY ?? height / 2;
  return (
    <mesh position={[Number(bounds.centerX || 0), y, Number(bounds.centerZ || 0)]} renderOrder={20}>
      <boxGeometry args={[width, height, depth]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.98} depthTest={false} />
    </mesh>
  );
}

function ObjHitbox({ bounds = null, size = [0.7, 0.7, 0.7], centerY = null }) {
  const x = Number(bounds?.width || size[0] || 0.7);
  const y = Number(bounds?.height || size[1] || 0.7);
  const z = Number(bounds?.depth || size[2] || 0.7);
  const centerX = Number(bounds?.centerX || 0);
  const centerZ = Number(bounds?.centerZ || 0);
  const thinVerticalPanel = Number(y || 0) >= 1.5 && Math.min(Number(x || 0), Number(z || 0)) <= 0.18;
  const minFootprint = thinVerticalPanel ? 0.08 : 0.18;
  return (
    <mesh position={[centerX, centerY ?? Math.max(y, 0.35) / 2, centerZ]}>
      <boxGeometry args={[Math.max(x, minFootprint), Math.max(y, 0.35), Math.max(z, minFootprint)]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Model3D({ item, selected, hovered, dragging, visualContext }) {
  const materialUrl = modelMaterialUrl(item);
  if (item.modelUrl?.toLowerCase().split('?')[0].endsWith('.glb')) return <GlbModel item={item} selected={selected} hovered={hovered} visualContext={visualContext} />;
  if (materialUrl) return <ObjModelWithMaterials item={item} materialUrl={materialUrl} selected={selected} hovered={hovered} visualContext={visualContext} />;
  return <ObjModel item={item} selected={selected} hovered={hovered} dragging={dragging} />;
}

function GlbModel({ item, selected, hovered, visualContext }) {
  const gltf = useGlbModel(item.modelUrl);
  const customImageTexture = useExternalTexture(isWoodReceptionDeskItem(item) ? item.options?.binary3ImageUrl : '', { flipY: false, coverSize: woodReceptionDeskImageCoverSize(item) });
  const counterColorTexture = useExternalTexture(isWoodReceptionDeskItem(item) ? item.options?.binary2ColorImage : '', { flipY: false });
  const mainImageTexture = useExternalTexture(isPartitionHeadItem(item) ? item.options?.headMainImageUrl : '', { flipY: false, coverSize: partitionHeadMainImageCoverSize(item) });
  const exhibitorTexture = useMemo(() => (
    isPartitionHeadItem(item) ? createPartitionHeadInfoTexture(visualContext, item, { flipY: false }) : null
  ), [item.type, item.label, item.modelUrl, visualContext?.fontRevision, visualContext?.language, visualContext?.company, visualContext?.standNumber, visualContext?.aisleNumber, visualContext?.hall, visualContext?.sector]);
  const model = useMemo(() => prepareLoadedModel(gltf.scene, item, {
    isGlb: true,
    customImageTexture,
    counterColorTexture,
    mainImageTexture,
    exhibitorTexture,
  }), [gltf, item, customImageTexture, counterColorTexture, mainImageTexture, exhibitorTexture]);
  return <primitive object={model} dispose={null} />;
}

function useGlbModel(modelUrl) {
  const entry = _ensureGlbCacheEntry(modelUrl);
  if (entry.error) throw entry.error;
  if (!entry.result) throw entry.promise;
  return entry.result;
}

function useMtlMaterials(materialUrl, item) {
  const entry = _ensureMtlCacheEntry(materialUrl, item);
  if (entry.error) throw entry.error;
  if (!entry.result) throw entry.promise;
  return entry.result;
}

function useObjModel(modelUrl, materials) {
  const entry = _ensureObjCacheEntry(modelUrl, materials);
  if (entry.error) throw entry.error;
  if (!entry.result) throw entry.promise;
  return entry.result;
}

function ObjModelWithMaterials({ item, materialUrl, selected, hovered, visualContext }) {
  const mainImageTexture = useExternalTexture(isPartitionHeadItem(item) ? item.options?.headMainImageUrl : '', { coverSize: partitionHeadMainImageCoverSize(item) });
  const customImageTexture = useExternalTexture(isWoodReceptionDeskItem(item) ? item.options?.binary3ImageUrl : '', { flipY: false, coverSize: woodReceptionDeskImageCoverSize(item) });
  const counterColorTexture = useExternalTexture(isWoodReceptionDeskItem(item) ? item.options?.binary2ColorImage : '');
  const exhibitorTexture = useMemo(() => (
    isPartitionHeadItem(item) ? createPartitionHeadInfoTexture(visualContext, item) : null
  ), [item.type, item.label, item.modelUrl, visualContext?.fontRevision, visualContext?.language, visualContext?.company, visualContext?.standNumber, visualContext?.aisleNumber, visualContext?.hall, visualContext?.sector]);
  const materials = useMtlMaterials(materialUrl, item);
  const mtlTexturesReady = useMtlTexturePreload(materials, item, materialUrl);

  if (!mtlTexturesReady) return null;

  return (
    <ObjModelWithPreparedMaterials
      item={item}
      materials={materials}
      mainImageTexture={mainImageTexture}
      customImageTexture={customImageTexture}
      counterColorTexture={counterColorTexture}
      exhibitorTexture={exhibitorTexture}
      selected={selected}
      hovered={hovered}
    />
  );
}

function ObjModelWithPreparedMaterials({ item, materials, mainImageTexture, customImageTexture, counterColorTexture, exhibitorTexture, selected, hovered }) {
  const obj = useObjModel(item.modelUrl, materials);
  const model = useMemo(() => prepareLoadedModel(obj, item, {
    mainImageTexture,
    customImageTexture,
    counterColorTexture,
    exhibitorTexture,
  }), [obj, item, mainImageTexture, customImageTexture, counterColorTexture, exhibitorTexture]);

  return <primitive object={model} dispose={null} />;
}

function useMtlTexturePreload(materials, item, materialUrl) {
  const urls = useMemo(() => collectMtlTextureUrls(materials, item, materialUrl), [materials, item, materialUrl]);
  const key = urls.join('|');
  const [ready, setReady] = useState(() => urls.length === 0 || urls.every(isDecodedTextureCached));

  useEffect(() => {
    if (!urls.length) {
      setReady(true);
      return undefined;
    }

    const missingUrls = urls.filter((url) => !isDecodedTextureCached(url));
    if (!missingUrls.length) {
      setReady(true);
      return undefined;
    }

    let cancelled = false;
    setReady(false);
    Promise.all(missingUrls.map((url) => preloadImage(url))).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return ready;
}

function isDecodedTextureCached(url = '') {
  if (!url) return true;
  return textureCacheUrlVariants(url).some((variant) => Boolean(Cache.get(`image:${variant}`)));
}

function collectMtlTextureUrls(materials, item, materialUrl) {
  const urls = new Set();
  const baseUrl = assetBaseUrl(materialUrl || item?.modelUrl || '');
  const textureProps = ['map_kd', 'map_ks', 'map_ke', 'norm', 'map_bump', 'bump', 'disp', 'map_d'];

  Object.values(materials?.materialsInfo || {}).forEach((materialInfo) => {
    textureProps.forEach((prop) => {
      const value = materialInfo?.[prop];
      if (!value) return;
      const textureUrl = resolveMtlTextureValueUrl(value, baseUrl, item);
      if (textureUrl && textureUrl !== blankTextureDataUrl) urls.add(textureUrl);
    });
  });

  return [...urls];
}

function resolveMtlTextureValueUrl(value, baseUrl, item) {
  const texturePath = mtlTexturePathFromValue(value);
  if (!texturePath) return '';
  const rawUrl = /^https?:\/\//i.test(texturePath) ? texturePath : `${baseUrl}${texturePath}`;
  return resolveModelResourceUrl(rawUrl, item);
}

function mtlTexturePathFromValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const matches = [...raw.replaceAll('\\', '/').matchAll(/([^"'\s]+?\.(?:jpe?g|png|webp|gif|bmp|tga|tiff?))(?:\?.*)?/gi)];
  return matches[matches.length - 1]?.[1] || '';
}

function modelMaterialUrl(item) {
  const explicitUrl = item?.materialUrl || item?.dimensions?.materialUrl || '';
  const modelRoot = storageRootFromPublicUrl(item?.modelUrl || '');
  const expectedRoot = item?.dimensions?.storageRoot || modelRoot;
  const explicitRoot = storageRootFromPublicUrl(explicitUrl);

  if (explicitUrl && rootsMatch(explicitRoot, expectedRoot)) return explicitUrl;

  const materialPath = item?.dimensions?.materialPath
    || (Array.isArray(item?.dimensions?.storagePaths) ? item.dimensions.storagePaths.find((path) => /\.mtl$/i.test(path)) : '');
  const rebuiltUrl = publicStorageUrlFromPath(item?.modelUrl || explicitUrl, materialPath);
  if (rebuiltUrl) return rebuiltUrl;

  return explicitUrl && !expectedRoot ? explicitUrl : null;
}

function ObjModel({ item, selected, hovered, dragging }) {
  const obj = useLoader(OBJLoader, item.modelUrl);
  const model = useMemo(() => {
    const clone = obj.clone(true);
    const material = new MeshStandardMaterial({
      color: activeColor(selected, dragging, defaultModelColor(item)),
      roughness: defaultModelRoughness(item),
      metalness: defaultModelMetalness(item),
      side: DoubleSide,
      ...hoverMaterialProps(selected, hovered),
    });

    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = material;
      }
    });

    return centerModel(clone, item);
  }, [obj, item, selected, hovered, dragging]);

  return <primitive object={model} dispose={null} />;
}

function prepareLoadedModel(source, item = null, textureOptions = {}) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = cloneMeshMaterial(child.material);
      child.material = applyItemOptionMaterials(child.material, item, textureOptions, child.name);
    }
  });
  return centerModel(clone, item);
}

function useExternalTexture(url, options = {}) {
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return undefined;
    }

    let disposed = false;
    let currentTexture = null;

    if (options.coverSize) {
      const applyImage = (image) => {
        if (!image?.naturalWidth) return false;
        try {
          const t = createCoverImageTexture(image, options.coverSize[0], options.coverSize[1], options);
          if (t) { currentTexture = t; setTexture(t); return true; }
        } catch (_) {}
        return false;
      };

      // Synchronous cache hit: if preloadImage already put the decoded image in
      // Three.js Cache, create the CanvasTexture immediately without any async gap.
      const cachedImage = Cache.get(`image:${url}`);
      if (cachedImage && applyImage(cachedImage)) {
        return () => { disposed = true; currentTexture?.dispose?.(); };
      }

      // Async path for when the preload cache isn't populated yet.
      loadDecodedImage(url).then(({ ok, image }) => {
        if (disposed) return;
        if (!ok || !image || !applyImage(image)) setTexture(null);
      });

      return () => { disposed = true; currentTexture?.dispose?.(); };
    }

    loadDecodedImage(url).then(({ ok, image }) => {
      if (disposed) return;
      if (!ok || !image) {
        setTexture(null);
        return;
      }
      const loadedTexture = createDecodedImageTexture(image, options);
      currentTexture = loadedTexture;
      setTexture(loadedTexture);
    });

    return () => {
      disposed = true;
      currentTexture?.dispose?.();
    };
  }, [url, options.coverSize?.[0], options.coverSize?.[1], options.flipY]);

  return texture;
}

function prepareDynamicTexture(texture, options = {}) {
  texture.flipY = options.flipY ?? true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createDecodedImageTexture(image, options = {}) {
  if (typeof document === 'undefined' || !image) return null;
  const width = image.naturalWidth || image.videoWidth || image.width || 1;
  const height = image.naturalHeight || image.videoHeight || image.height || 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  return prepareDynamicTexture(new CanvasTexture(canvas), options);
}

function createCoverImageTexture(image, targetWidth, targetHeight, options = {}) {
  if (typeof document === 'undefined' || !image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  const imageWidth = image.naturalWidth || image.videoWidth || image.width || targetWidth;
  const imageHeight = image.naturalHeight || image.videoHeight || image.height || targetHeight;
  const scale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const dx = (targetWidth - drawWidth) / 2;
  const dy = (targetHeight - drawHeight) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  return prepareDynamicTexture(new CanvasTexture(canvas), options);
}

function posterCoverTextureSize(region = null, maxLongEdge = 1600) {
  const safeWidth = Math.max(0.001, Number(region?.width || 1));
  const safeHeight = Math.max(0.001, Number(region?.height || 1));
  const ratio = safeWidth / safeHeight;
  if (ratio >= 1) return [maxLongEdge, Math.max(256, Math.round(maxLongEdge / ratio))];
  return [Math.max(256, Math.round(maxLongEdge * ratio)), maxLongEdge];
}

function applyItemOptionMaterials(material, item, textureOptions = {}, meshName = '') {
  if (Array.isArray(material)) return material.map((entry) => applyItemOptionMaterials(entry, item, textureOptions, meshName));
  if (!material) return material;

  const materialName = normalizeMaterialName(material.name);
  if (isWoodReceptionDeskItem(item)) {
    if (textureOptions.customImageTexture && isWoodReceptionDeskImageMaterial(materialName, material, item)) {
      return materialWithTexture(material, textureOptions.customImageTexture);
    }
    if (textureOptions.counterColorTexture && isWoodReceptionDeskColorMaterial(materialName, material)) {
      return materialWithTexture(material, textureOptions.counterColorTexture);
    }
    if (item?.options?.binary2Color && isWoodReceptionDeskColorMaterial(materialName, material)) {
      return materialWithColor(material, item.options.binary2Color);
    }
  }

  if (!isPartitionHeadItem(item)) return material;
  if (textureOptions.mainImageTexture && isPartitionHeadMainImageMaterial(materialName, material, item)) {
    return materialWithTexture(material, textureOptions.mainImageTexture);
  }
  const smclExhibitorTexture = smclExhibitorTextureForMaterial(textureOptions.exhibitorTexture, materialName, material, item);
  if (smclExhibitorTexture) {
    return materialWithTexture(material, smclExhibitorTexture, { luminous: true });
  }
  if (textureOptions.exhibitorTexture && !isSmclPartitionHeadItem(item) && shouldUseExhibitorHeadTexture(materialName, meshName, item, material)) {
    return materialWithTexture(material, textureOptions.exhibitorTexture);
  }
  return material;
}

function isWoodReceptionDeskItem(item = {}) {
  const text = normalizedItemText(item);
  return (text.includes('banque') && text.includes('accueil')) || (text.includes('comptoir') && text.includes('accueil'));
}

function materialMatchesReference(materialName = '', material = null, normalizedNeedle = '', fileName = '') {
  return materialName.includes(normalizedNeedle) || materialMapMatchesFile(material, fileName);
}

function isWoodReceptionDeskImageMaterial(materialName = '', material = null, item = {}) {
  const width = itemDefaultSize(item)?.[0] || 1.0;
  const target = width >= 1.85 ? '_2' : '_1';
  return materialName === target || new RegExp(`^${target}(\\.\\d+)?$`).test(materialName)
    || materialMatchesReference(materialName, material, 'binary_3', 'Binary_3.jpeg');
}

function woodReceptionDeskImageCoverSize(item = {}) {
  const width = itemDefaultSize(item)?.[0] || 1.0;
  if (width >= 1.85) return [2400, 800];
  if (width >= 1.25) return [1800, 800];
  return [1200, 800];
}

function isWoodReceptionDeskColorMaterial(materialName = '', material = null) {
  return materialName.includes('laminate_d02_120cm_6')
    || materialName.includes('binary_0')
    || materialMatchesReference(materialName, material, 'binary_0', 'Binary_0.jpeg');
}

function partitionHeadMainImageMaterial(item = {}) {
  return isSmclPartitionHeadItem(item) ? 'led_5500k_8' : 'led_5500k_1';
}

function partitionHeadMainImageCoverSize(item = {}) {
  return isSmclPartitionHeadItem(item) ? [947, 593] : [474, 296];
}

function isPartitionHeadMainImageMaterial(materialName = '', material = null, item = {}) {
  const target = partitionHeadMainImageMaterial(item);
  return materialName.includes(target)
    || materialMatchesReference(materialName, material, target, `${target}.jpg`);
}

function shouldUseExhibitorHeadTexture(materialName = '', meshName = '', item = {}, material = null) {
  const normalizedMeshName = normalizeMaterialName(meshName);
  if (isSmclPartitionHeadItem(item)) {
    return Boolean(smclInfoLayoutSideForMaterial(materialName, material, item)) || isLikelySmclInfoPanelMesh(normalizedMeshName);
  }
  return materialName === '_10'
    || materialName === '10'
    || materialName.endsWith('_10')
    || (normalizedMeshName.includes('mesh4') && normalizedMeshName.includes('group3'));
}

function smclExhibitorTextureForMaterial(exhibitorTexture, materialName = '', material = null, item = {}) {
  if (!isSmclPartitionHeadItem(item) || !exhibitorTexture) return null;
  const layoutSide = smclInfoLayoutSideForMaterial(materialName, material, item);
  if (!layoutSide) return null;
  return exhibitorTexture[layoutSide] || null;
}

function smclInfoLayoutSideForMaterial(materialName = '', material = null, item = {}) {
  if (!isSmclPartitionHeadItem(item)) return null;
  if (materialName === '_' || materialMapMatchesFile(material, '_.jpg')) return 'left';
  if (materialName === '_51' || materialMapMatchesFile(material, '_51.jpg')) return 'right';
  return null;
}

function isLikelySmclInfoPanelMesh(normalizedMeshName = '') {
  if (!normalizedMeshName) return false;
  return normalizedMeshName.includes('info')
    || normalizedMeshName.includes('visuel')
    || normalizedMeshName.includes('picture')
    || normalizedMeshName.includes('exhibitor')
    || normalizedMeshName.includes('mesh4')
    || (normalizedMeshName.includes('group') && normalizedMeshName.includes('3'));
}

function materialMapMatchesFile(material = null, targetFileName = '') {
  const fileName = materialMapFileName(material);
  return Boolean(fileName && targetFileName && normalizeStorageLookup(fileName) === normalizeStorageLookup(targetFileName));
}

function materialMapFileName(material = null) {
  const data = material?.map?.image || material?.map?.source?.data;
  const source = data?.currentSrc
    || data?.src
    || data?.name
    || material?.map?.name
    || material?.map?.source?.name
    || material?.map?.userData?.name
    || '';
  return safeDecodeUri(String(source || '').replaceAll('\\', '/').split('/').pop() || '');
}

function materialWithTexture(material, texture, options = {}) {
  const next = material.clone?.() || material;
  next.map = texture;
  next.transparent = false;
  if (next.color?.set) next.color.set('#ffffff');
  if (options.luminous) {
    if (next.emissive?.set) next.emissive.set('#ffffff');
    if ('emissiveMap' in next) next.emissiveMap = texture;
    if ('emissiveIntensity' in next) next.emissiveIntensity = 0.42;
    if ('toneMapped' in next) next.toneMapped = false;
    if ('roughness' in next) next.roughness = 0.9;
    if ('metalness' in next) next.metalness = 0;
  }
  next.needsUpdate = true;
  return next;
}

function materialWithColor(material, color) {
  const next = material.clone?.() || material;
  next.map = null;
  next.transparent = false;
  if (next.color?.set) next.color.set(color);
  next.needsUpdate = true;
  return next;
}

function applyVisualStateMaterial(material, textureOptions = {}) {
  if (Array.isArray(material)) return material.map((entry) => applyVisualStateMaterial(entry, textureOptions));
  if (!material) return material;
  if (!textureOptions.hovered || textureOptions.selected) return material;
  const next = material.clone?.() || material;
  next.transparent = true;
  next.opacity = textureOptions.isGlb
    ? Math.max(Number(next.opacity ?? 1) * 0.82, 0.68)
    : 0.48;
  next.depthWrite = textureOptions.isGlb ? true : false;
  next.needsUpdate = true;
  return next;
}

function normalizeMaterialName(name = '') {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function createPartitionHeadInfoTexture(visualContext = {}, item = {}, options = {}) {
  if (typeof document === 'undefined') return null;
  if (isSmclPartitionHeadItem(item)) {
    return {
      left: createSmclPartitionHeadInfoTexture(visualContext, item, { ...options, layoutSide: 'left' }),
      right: createSmclPartitionHeadInfoTexture(visualContext, item, { ...options, layoutSide: 'right' }),
    };
  }

  const canvas = document.createElement('canvas');
  // Same pixel format as the original _10.jpg so the SketchUp UVs keep lining up.
  canvas.width = 656;
  canvas.height = 407;
  const ctx = canvas.getContext('2d');
  const company = String(visualContext?.company || 'Nom société').trim();
  const standNumber = String(visualContext?.standNumber || 'A-14').replace(/^Stand\s+/i, '').trim();
  const language = visualContext?.language || 'fr';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawLanguageFlag(ctx, language, 22, 23, 66, 44);
  ctx.fillStyle = '#050505';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  fitCanvasText(ctx, company.toUpperCase(), 156, 17, 350, 57);
  fitCanvasText(ctx, (standNumber || 'A-14').toUpperCase(), 544, 17, 90, 57);

  const texture = new CanvasTexture(canvas);
  texture.flipY = options.flipY ?? true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createSmclPartitionHeadInfoTexture(visualContext = {}, item = {}, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1181;
  canvas.height = 827;
  const ctx = canvas.getContext('2d');
  const company = String(visualContext?.company || 'NOM EXPOSANT').trim().toUpperCase();
  const aisleNumber = String(visualContext?.aisleNumber || '').replace(/^All[ée]e?\s*/i, '').trim().toUpperCase();
  const standNumber = String(visualContext?.standNumber || '—').replace(/^Stand\s+/i, '').trim().toUpperCase();
  const sectorColor = smclSectorColor(visualContext?.sector);
  const isRight = (options.layoutSide || smclPartitionHeadSide(item)) === 'right';

  ctx.fillStyle = sectorColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  if (isRight) {
    drawSmclRightHeadInfo(ctx, { company, aisleNumber, standNumber });
  } else {
    drawSmclLeftHeadInfo(ctx, { company, aisleNumber, standNumber });
  }

  return prepareDynamicTexture(new CanvasTexture(canvas), options);
}

function smclCanvasFont(weight = 400, size = 80) {
  return `${weight} ${size}px Oswald, "Arial Narrow", "Helvetica Neue Condensed", Impact, Arial, sans-serif`;
}

function drawSmclLeftHeadInfo(ctx, { company, aisleNumber, standNumber }) {
  const labelX = 245;
  fitCanvasText(ctx, company, 238, 48, 690, 92, 700);
  fitCanvasText(ctx, aisleNumber ? `ALLÉE ${aisleNumber}` : 'ALLÉE —', labelX, 205, 360, 92, 500);
  fitCanvasText(ctx, standNumber || '—', labelX, 365, 360, 92, 500);
  drawSmclSalonMark(ctx, labelX, 620, 0.86);
  drawSmclPartnerMarks(ctx, labelX, 760, 0.9);
}

function drawSmclRightHeadInfo(ctx, { company, aisleNumber, standNumber }) {
  fitCanvasText(ctx, company, 290, 48, 700, 92, 700);
  fitCanvasText(ctx, aisleNumber ? `ALLÉE ${aisleNumber}` : 'ALLÉE —', 765, 205, 360, 92, 500);
  fitCanvasText(ctx, standNumber || '—', 765, 365, 360, 92, 500);
  drawSmclSalonMark(ctx, 770, 620, 0.86);
  drawSmclPartnerMarks(ctx, 770, 760, 0.9);
}

function drawSmclSalonMark(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 42, 64);
  ctx.fillStyle = '#397084';
  ctx.fillRect(9, 0, 15, 28);
  ctx.fillStyle = '#c34e3d';
  ctx.beginPath();
  ctx.moveTo(9, 51);
  ctx.lineTo(24, 37);
  ctx.lineTo(24, 61);
  ctx.lineTo(9, 61);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = smclCanvasFont(700, 36);
  ctx.fillText('salon', 52, -3);
  ctx.font = smclCanvasFont(700, 36);
  ctx.fillText('des maires', 52, 25);
  ctx.font = smclCanvasFont(300, 17);
  ctx.fillText('et des collectivités locales', 52, 54);
  ctx.restore();
}

function drawSmclPartnerMarks(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.font = smclCanvasFont(400, 20);
  ctx.fillText('/// infoprodigital', 0, 0);
  ctx.font = smclCanvasFont(700, 20);
  ctx.fillText('✹amf', 178, 0);
  ctx.font = smclCanvasFont(300, 8);
  ctx.fillText('ASSOCIATION DES MAIRES', 180, 21);
  ctx.restore();
}

function smclSectorColor(sector = '') {
  const key = normalizeLookupText(sector);
  const matches = [
    { tokens: ['transport', 'mobilite', 'parkopolis'], color: '#EC7620' },
    { tokens: ['environnement', 'cadre', 'vie'], color: '#A4B21B' },
    { tokens: ['construction', 'amenagement'], color: '#9B5416' },
    { tokens: ['securite', 'prevention', 'protection'], color: '#E20519' },
    { tokens: ['developpement', 'attractivite', 'territoriale'], color: '#00ADE9' },
    { tokens: ['energie', 'climat'], color: '#FFD100' },
    { tokens: ['culture', 'loisirs', 'evenements'], color: '#E84442' },
    { tokens: ['sante', 'social', 'vivre', 'ensemble'], color: '#E95899' },
    { tokens: ['numerique', 'connectivite'], color: '#6C2E87' },
    { tokens: ['salon', 'sports'], color: '#044ED2' },
  ];
  return matches.find((entry) => entry.tokens.every((token) => key.includes(token)))?.color || '#FFD100';
}

function drawLanguageFlag(ctx, language, x, y, width, height) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  if (language === 'en') {
    ctx.fillStyle = '#0a2f78';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y + height);
    ctx.moveTo(x + width, y);
    ctx.lineTo(x, y + height);
    ctx.stroke();
    ctx.strokeStyle = '#d21f3c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y + height);
    ctx.moveTo(x + width, y);
    ctx.lineTo(x, y + height);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + width / 2 - 6, y, 12, height);
    ctx.fillRect(x, y + height / 2 - 6, width, 12);
    ctx.fillStyle = '#d21f3c';
    ctx.fillRect(x + width / 2 - 3, y, 6, height);
    ctx.fillRect(x, y + height / 2 - 3, width, 6);
  } else {
    ctx.fillStyle = '#1f2474';
    ctx.fillRect(x, y, width / 3, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + width / 3, y, width / 3, height);
    ctx.fillStyle = '#e60028';
    ctx.fillRect(x + (width * 2) / 3, y, width / 3, height);
  }
  ctx.restore();
}

function fitCanvasText(ctx, text, x, y, maxWidth, baseSize, weight = 900) {
  let size = baseSize;
  do {
    ctx.font = smclCanvasFont(weight, size);
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 24);
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function cloneMeshMaterial(material) {
  if (Array.isArray(material)) return material.map(cloneAndNormalizeMaterial);
  return cloneAndNormalizeMaterial(material);
}

function cloneAndNormalizeMaterial(material) {
  const cloned = material?.clone?.() || material;
  if (!cloned) return cloned;

  cloned.side = DoubleSide;
  normalizeMaterialTexture(cloned.map);

  if (cloned.map && cloned.color?.set) {
    // SketchUp MTL often combines map_Kd with a mid-grey Kd, which multiplies
    // the texture and makes aluminium assets almost black in Three.js.
    cloned.color.set('#ffffff');
  } else if (isAluminiumMaterial(cloned) && cloned.color?.set) {
    cloned.color.set('#bfc5c8');
  }

  if (isAluminiumMaterial(cloned)) {
    if ('metalness' in cloned) cloned.metalness = 0.35;
    if ('roughness' in cloned) cloned.roughness = 0.42;
    if ('shininess' in cloned) cloned.shininess = 55;
  }

  cloned.needsUpdate = true;
  return cloned;
}

function normalizeMaterialTexture(texture) {
  if (!texture) return;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = Math.max(texture.anisotropy || 1, 4);
  texture.needsUpdate = true;
}

function isAluminiumMaterial(material = {}) {
  return /alu|minium|metal|brushed/i.test(material.name || '');
}

function defaultModelColor(item) {
  if (/porte[-_ ]?doc/i.test(item?.type || item?.label || '')) return '#bfc5c8';
  return item?.color || '#ece7da';
}

function defaultModelMetalness(item) {
  return /porte[-_ ]?doc/i.test(item?.type || item?.label || '') ? 0.35 : 0.03;
}

function defaultModelRoughness(item) {
  return /porte[-_ ]?doc/i.test(item?.type || item?.label || '') ? 0.42 : 0.58;
}

function assetBaseUrl(url = '') {
  if (!url || !url.includes('/')) return '';
  return url.slice(0, url.lastIndexOf('/') + 1);
}

function storageRootFromPublicUrl(url = '') {
  const match = String(url || '').match(/\/object\/public\/object-assets\/([^/?#]+)/);
  return match ? safeDecodeUri(match[1]) : '';
}

function rootsMatch(left = '', right = '') {
  if (!left || !right) return true;
  return normalizeStorageLookup(left) === normalizeStorageLookup(right);
}

function publicStorageUrlFromPath(referenceUrl = '', storagePath = '') {
  if (!referenceUrl || !storagePath) return '';
  const marker = '/object/public/object-assets/';
  const markerIndex = String(referenceUrl).indexOf(marker);
  if (markerIndex < 0) return '';
  const bucketBaseUrl = String(referenceUrl).slice(0, markerIndex + marker.length);
  return `${bucketBaseUrl}${encodeTexturePath(storagePath)}`;
}

function resolveModelResourceUrl(url, item) {
  if (!isTextureResource(url)) return url;
  const baseUrl = assetBaseUrl(modelMaterialUrl(item) || item?.modelUrl || '');
  if (!baseUrl) return url;

  const cleanUrl = url.split('?')[0];
  const fileName = textureFileNameFromReference(cleanUrl);
  if (!fileName) return url;

  const rootPath = item?.dimensions?.storageRoot || item?.type || '';
  const storagePaths = Array.isArray(item?.dimensions?.storagePaths) ? item.dimensions.storagePaths : [];
  const normalizedFileName = normalizeStorageLookup(fileName);
  const matchingPath = findMatchingTextureStoragePath(storagePaths, fileName, rootPath);
  if (matchingPath && rootPath && normalizeStorageLookup(matchingPath).startsWith(`${normalizeStorageLookup(rootPath)}/`)) {
    return textureUrlFromStoragePath(baseUrl, rootPath, matchingPath);
  }

  const relativeTexturePath = relativeTexturePathFromUrl(url, baseUrl, rootPath);
  if (relativeTexturePath) {
    const matchingRelativePath = storagePaths.find((path) => {
      const relativePath = rootPath && normalizeStorageLookup(path).startsWith(`${normalizeStorageLookup(rootPath)}/`)
        ? path.split('/').slice(1).join('/')
        : path;
      return normalizeStorageLookup(relativePath) === normalizeStorageLookup(relativeTexturePath);
    });
    if (matchingRelativePath && rootPath && isStoragePathInsideRoot(matchingRelativePath, rootPath)) {
      return textureUrlFromStoragePath(baseUrl, rootPath, matchingRelativePath);
    }
  }

  if (!storagePaths.length && relativeTexturePath && isSafeRelativeTexturePath(relativeTexturePath)) {
    return `${baseUrl}${encodeTexturePath(fileName)}`;
  }

  if (storagePaths.length) {
    logTextureDiagnostic('Texture reference ignored because it is missing from object storage paths', {
      item: item?.label || item?.type,
      texture: url,
      rootPath,
    });
    return blankTextureDataUrl;
  }

  const modelFolder = modelSiblingFolder(item?.modelUrl || modelMaterialUrl(item) || '');
  const shouldTryModelFolder = /arche|jardiniere|jardinière/i.test(`${item?.type || ''} ${item?.label || ''} ${modelFolder}`);
  if (shouldTryModelFolder && modelFolder && !cleanUrl.includes(`/${modelFolder}/`)) {
    return `${baseUrl}${encodeURIComponent(modelFolder)}/${encodeURIComponent(fileName)}`;
  }

  return blankTextureDataUrl;
}

function rewriteRuntimeMtlReferences(text, item) {
  const rootPath = item?.dimensions?.storageRoot || item?.type || '';
  const storagePaths = Array.isArray(item?.dimensions?.storagePaths) ? item.dimensions.storagePaths : [];
  if (!text || !storagePaths.length || !rootPath) return text;

  const texturePaths = storagePaths
    .filter(isTextureResource)
    .filter((path) => isStoragePathInsideRoot(path, rootPath))
    .map((path) => ({
      path,
      fileName: safeDecodeUri(String(path).replaceAll('\\', '/').split('/').pop() || ''),
      relativePath: textureRelativePath(rootPath, path),
    }))
    .filter((entry) => entry.fileName && entry.relativePath);

  if (!texturePaths.length) return text;

  return String(text).split('\n').map((line) => {
    const match = line.match(/^(\s*(?:map_[a-z0-9_]+|bump|disp|decal|refl)\s+)(.+)$/i);
    if (!match) return line;
    const value = match[2].trim();
    const texture = texturePaths.find((entry) => textureReferenceMatches(value, entry.fileName, entry.relativePath));
    if (!texture) {
      logTextureDiagnostic('MTL texture line kept for safe URL resolver', {
        item: item?.label || item?.type,
        texture: value,
        rootPath,
      });
      return line;
    }
    return `${match[1]}${texture.relativePath}`;
  }).join('\n');
}

function findMatchingTextureStoragePath(storagePaths = [], fileName = '', rootPath = '') {
  return (storagePaths || [])
    .filter(isTextureResource)
    .filter((path) => isStoragePathInsideRoot(path, rootPath))
    .find((path) => textureReferenceMatches(fileName, textureFileNameFromReference(path), textureRelativePath(rootPath, path)));
}

function textureReferenceMatches(reference = '', candidateFileName = '', candidateRelativePath = '') {
  const normalizedReference = normalizeTextureName(reference);
  const normalizedCandidate = normalizeTextureName(candidateFileName);
  if (!normalizedReference || !normalizedCandidate) return false;
  if (normalizedReference.includes(normalizedCandidate)) return true;

  const normalizedReferencePath = normalizeTexturePath(reference);
  const normalizedCandidatePath = normalizeTexturePath(candidateRelativePath);
  if (normalizedReferencePath && normalizedCandidatePath && normalizedReferencePath.endsWith(normalizedCandidatePath)) return true;

  const referenceStem = normalizedReference.replace(/\.[a-z0-9]+$/i, '');
  const candidateStem = normalizedCandidate.replace(/\.[a-z0-9]+$/i, '');
  if (!isMeaningfulTextureStem(referenceStem) || !isMeaningfulTextureStem(candidateStem)) return false;
  return Boolean(referenceStem.includes(candidateStem) || candidateStem.includes(referenceStem));
}

function textureFileNameFromReference(value = '') {
  const cleanValue = safeDecodeUri(String(value || '').split('?')[0]).replaceAll('\\', '/');
  const matches = [...cleanValue.matchAll(/([^/"'\s]+?\.(?:jpe?g|png|webp|gif|bmp|tga|tiff?))/gi)];
  const match = matches[matches.length - 1]?.[1] || cleanValue.split('/').pop() || '';
  return safeDecodeUri(String(match).replaceAll('\\', '/').split('/').pop() || '');
}

function normalizeTextureName(value = '') {
  const fileName = textureFileNameFromReference(value);
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-');
}

function normalizeTexturePath(value = '') {
  return safeDecodeUri(String(value || ''))
    .replaceAll('\\', '/')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map((segment) => normalizeStorageLookup(segment))
    .join('/');
}

function isMeaningfulTextureStem(stem = '') {
  return (String(stem).match(/[a-z0-9]/g) || []).length >= 3;
}

function isSafeRelativeTexturePath(path = '') {
  const normalized = String(path || '').replaceAll('\\', '/');
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.includes('..')
    && !/^https?:/i.test(normalized);
}

function isStoragePathInsideRoot(storagePath = '', rootPath = '') {
  if (!rootPath) return true;
  return normalizeStorageLookup(storagePath).startsWith(`${normalizeStorageLookup(rootPath)}/`);
}

function textureRelativePath(rootPath, storagePath) {
  const normalizedRoot = normalizeStorageLookup(rootPath);
  const segments = String(storagePath || '').replaceAll('\\', '/').split('/').filter(Boolean);
  const relativeSegments = normalizeStorageLookup(segments[0]) === normalizedRoot ? segments.slice(1) : segments;
  return relativeSegments.map((segment) => safeDecodeUri(segment)).join('/');
}

function textureUrlFromStoragePath(baseUrl, rootPath, storagePath) {
  const normalizedRoot = normalizeStorageLookup(rootPath);
  const segments = String(storagePath || '').replaceAll('\\', '/').split('/').filter(Boolean);
  const relativeSegments = normalizeStorageLookup(segments[0]) === normalizedRoot ? segments.slice(1) : segments;
  return `${baseUrl}${relativeSegments.map((segment) => encodeURIComponent(safeDecodeUri(segment))).join('/')}`;
}

function relativeTexturePathFromUrl(url, baseUrl, rootPath) {
  const cleanUrl = String(url || '').split('?')[0].replaceAll('\\', '/');
  const decodedUrl = safeDecodeUri(cleanUrl);
  const decodedBase = safeDecodeUri(baseUrl).replace(/\/$/, '');

  if (decodedUrl.startsWith(`${decodedBase}/`)) {
    return decodedUrl.slice(decodedBase.length + 1);
  }

  if (rootPath) {
    const normalizedRoot = normalizeStorageLookup(rootPath.replace(/^\/+|\/+$/g, ''));
    const parts = decodedUrl.split('/').filter(Boolean);
    const rootIndex = parts.findIndex((part) => normalizeStorageLookup(part) === normalizedRoot);
    if (rootIndex >= 0 && rootIndex < parts.length - 1) return parts.slice(rootIndex + 1).join('/');

    const marker = `/${rootPath.replace(/^\/+|\/+$/g, '')}/`;
    const index = decodedUrl.indexOf(marker);
    if (index >= 0) return decodedUrl.slice(index + marker.length);
  }

  if (isSafeRelativeTexturePath(decodedUrl)) return decodedUrl;

  return '';
}

function encodeTexturePath(path = '') {
  return String(path)
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(safeDecodeUri(segment)))
    .join('/');
}

function normalizeStorageLookup(value = '') {
  return safeDecodeUri(String(value || ''))
    .replaceAll('\\', '/')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function safeDecodeUri(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function modelSiblingFolder(url = '') {
  const fileName = decodeURIComponent(String(url).split('?')[0].replaceAll('\\', '/').split('/').pop() || '');
  const stem = fileName.replace(/\.[^.]+$/, '');
  return stem ? stem.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[.-]+|[.-]+$/g, '') : '';
}

function isTextureResource(url = '') {
  return /\.(jpe?g|png|webp|gif|bmp|tga|tiff?)(\?.*)?$/i.test(url);
}

function centerModel(model, item = null) {
  const box = new Box3().setFromObject(model);
  if (item) {
    const actualSize = box.getSize(new Vector3());
    const desiredSize = itemDefaultSize(item);
    const actualMax = Math.max(actualSize.x, actualSize.y, actualSize.z);
    const desiredMax = Math.max(...desiredSize.map((value) => Number(value) || 0));
    if (Number.isFinite(actualMax) && actualMax > 0 && Number.isFinite(desiredMax) && desiredMax > 0) {
      const scale = desiredMax / actualMax;
      if (Number.isFinite(scale) && scale > 0 && (scale < 0.25 || scale > 4)) {
        model.scale.setScalar(scale);
        model.updateMatrixWorld(true);
      }
    }
  }

  const scaledBox = new Box3().setFromObject(model);
  const center = scaledBox.getCenter(new Vector3());
  const anchorY = isCenterAnchoredWallModel(item) ? -center.y : -scaledBox.min.y;
  model.position.set(-center.x, anchorY, -center.z);
  return model;
}

function Chair({ selected, hovered, dragging }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.28, 0]}>
        <boxGeometry args={[0.52, 0.12, 0.5]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#c85f3f')} roughness={0.55} {...hoverMaterialProps(selected, hovered)} />
      </mesh>
      <mesh castShadow position={[0, 0.72, -0.22]}>
        <boxGeometry args={[0.52, 0.75, 0.1]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#bd5138')} roughness={0.55} {...hoverMaterialProps(selected, hovered)} />
      </mesh>
      {[-0.18, 0.18].map((x) => [-0.16, 0.16].map((z) => (
        <mesh key={`${x}-${z}`} castShadow position={[x, 0.12, z]}>
          <cylinderGeometry args={[0.025, 0.025, 0.25, 12]} />
          <meshStandardMaterial color="#3b3a33" {...hoverMaterialProps(selected, hovered)} />
        </mesh>
      )))}
    </group>
  );
}

function Table({ selected, hovered, dragging }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.48, 0.48, 0.08, 48]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#1d8f83')} roughness={0.5} {...hoverMaterialProps(selected, hovered)} />
      </mesh>
      <mesh castShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.055, 0.075, 0.58, 18]} />
        <meshStandardMaterial color="#35423c" {...hoverMaterialProps(selected, hovered)} />
      </mesh>
      <mesh castShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.05, 28]} />
        <meshStandardMaterial color="#35423c" {...hoverMaterialProps(selected, hovered)} />
      </mesh>
    </group>
  );
}

function Counter({ selected, hovered, dragging }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.48, 0]}>
        <boxGeometry args={[1.05, 0.9, 0.45]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#d5b767')} roughness={0.46} {...hoverMaterialProps(selected, hovered)} />
      </mesh>
      <mesh castShadow position={[0, 0.96, -0.08]}>
        <boxGeometry args={[1.15, 0.1, 0.5]} />
        <meshStandardMaterial color="#fff8db" roughness={0.42} {...hoverMaterialProps(selected, hovered)} />
      </mesh>
    </group>
  );
}

function WallMountedItem({ item, items, width, depth, selected, hovered, dragging, onSelect, onHover, onDragStart, onDragEnd, onDragMove, visualContext }) {
  const isPoster = isPosterItem(item);
  const posterRegion = isPoster ? posterSurfaceRegion(item, items, width, depth) : null;
  const posterCoverSize = posterCoverTextureSize(posterRegion);
  const posterTexture = useExternalTexture(isPoster ? item.options?.posterImageUrl : '', { coverSize: posterCoverSize });
  const objectTransform = objectWallTransform(item, items);
  const rotation = objectTransform?.rotation ?? (item.wall === 'left' ? Math.PI / 2 : item.wall === 'right' ? -Math.PI / 2 : 0);
  const offset = objectTransform?.position ?? screenWorldPosition(item, width, depth, items);
  const isCustomModel = Boolean(item.modelUrl);
  const posterWidth = posterRegion?.width || 0.95;
  const posterHeight = posterRegion?.height || fixedWallHeight;
  return (
    <group
      position={offset}
      rotation={[0, rotation, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerOver={onHover ? ((event) => { event.stopPropagation(); onHover(true); }) : undefined}
      onPointerOut={onHover ? ((event) => { event.stopPropagation(); onHover(false); }) : undefined}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerMove={(event) => {
        if (dragging) onDragMove(event);
      }}
    >
      {isPoster ? (
        <>
          <mesh>
            <boxGeometry args={[posterWidth, posterHeight, 0.018]} />
            <meshStandardMaterial color={activeColor(selected, dragging, '#f7f1dc')} roughness={0.62} />
          </mesh>
          <mesh position={[0, 0, 0.014]}>
            <boxGeometry args={[posterWidth, posterHeight, 0.006]} />
            <meshStandardMaterial color="#ffffff" map={posterTexture || null} roughness={0.5} />
          </mesh>
          {!posterTexture && <Text position={[0, 0, 0.022]} fontSize={Math.min(0.18, posterWidth / 8)} color="#1f4378" anchorX="center" anchorY="middle">AFFICHE</Text>}
          {selected && <SelectionFrame bounds={{ width: posterWidth, height: posterHeight, depth: 0.05 }} centerY={0} />}
        </>
      ) : isCustomModel ? (
        <SceneItemContent item={item} selected={selected} hovered={hovered} dragging={dragging} visualContext={visualContext} />
      ) : (
        <>
          <mesh castShadow>
            <boxGeometry args={[0.95, 0.58, 0.06]} />
            <meshStandardMaterial color={activeColor(selected, dragging, '#182233')} roughness={0.4} {...hoverMaterialProps(selected, hovered)} />
          </mesh>
          <mesh position={[0, 0, 0.035]}>
            <boxGeometry args={[0.82, 0.45, 0.015]} />
            <meshStandardMaterial color="#67d7ff" emissive="#1c6887" emissiveIntensity={0.55} {...hoverMaterialProps(selected, hovered)} />
          </mesh>
          {selected && <SelectionFrame bounds={{ width: 0.95, height: 0.58, depth: 0.08 }} centerY={0} />}
        </>
      )}
    </group>
  );
}

createRoot(document.getElementById('root')).render(<App />);
