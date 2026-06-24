import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useLoader } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Text } from '@react-three/drei';
import { Box3, CanvasTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, LoadingManager, MeshStandardMaterial, Plane, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
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
import { deleteObjectBankItem, deleteStandPreset, ensureSalonOffer, getSceneByToken, listClients, listObjectBank, listSalons, listScenes, requestSceneAccessCode, saveMondayBoardForPack, saveObjectBankItem, saveSalonOfferBaseItems, saveScene, saveStandPresetConfig, sceneShareUrl, syncMondayScenes, uploadObjectAssetFolder, uploadObjectAssetThumbnail, uploadSceneItemOptionImage, verifySceneAccessCode } from './data/sceneStore.js';
import { exportTechnicalPng } from './technicalExport.js';
import './styles.css';

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const wallSwitchZone = 0.18;
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
const collisionPlacementStep = 0.25;
const ledSpotAreaMeters = 3;
const ledRailDefaultCenterY = fixedWallHeight - 0.11;
const ceilingObjectBottomY = 3;
const blankTextureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const textureRetryAttempts = 4;
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
  { id: 'free', label: 'Libre', description: 'L’utilisateur peut poser et déplacer cet objet normalement.' },
  { id: 'back-left', label: 'Coin arrière gauche', description: 'L’objet se colle automatiquement dans le coin arrière gauche.' },
  { id: 'back-right', label: 'Coin arrière droite', description: 'L’objet se colle automatiquement dans le coin arrière droit.' },
  { id: 'front-left', label: 'Coin avant gauche', description: 'L’objet se colle automatiquement dans le coin avant gauche.' },
  { id: 'front-right', label: 'Coin avant droite', description: 'L’objet se colle automatiquement dans le coin avant droit.' },
  { id: 'outer-left', label: 'Le plus à gauche', description: 'L’objet se place sur le mur gauche si disponible, sinon au fond côté gauche.' },
  { id: 'outer-right', label: 'Le plus à droite', description: 'L’objet se place sur le mur droit si disponible, sinon au fond côté droit.' },
  { id: 'back-center', label: 'Centre arrière', description: 'L’objet reste centré contre le mur du fond.' },
];
const assetCategoryOptions = ['Sol & Cloisons', 'Mobilier', 'Signalétique', 'Multimédia', 'Enseignes', 'Électricité'];

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
      setError(requestError.message || 'Impossible d’envoyer le code de connexion.');
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
            <p>Pour protéger votre configuration, saisissez le code envoyé à l’adresse liée à votre stand.</p>
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
  const initialOptions = initialScene.options || initialScene.source_payload?.options || {};
  const initialWidth = initialScene.dimensions?.width || 4;
  const initialDepth = initialScene.dimensions?.depth || 3;
  const initialLayout = initialScene.layout || 'u';
  const [width, setWidth] = useState(initialWidth);
  const [depth, setDepth] = useState(initialDepth);
  const height = fixedWallHeight;
  const [layout, setLayout] = useState(initialLayout);
  const [items, setItems] = useState(() => (initialScene.items?.length ? initialScene.items : [
    { id: 'table-1', type: 'table', x: -0.75, z: 0.3, y: 0, rotation: 0 },
    { id: 'chair-1', type: 'chair', x: 0.8, z: 0.45, y: 0, rotation: -15 },
    { id: 'screen-1', type: 'screen', x: 0, z: -1.5, y: screenCenterHeight, wall: 'back', rotation: 0 },
  ]).map((item) => constrainItem(item, initialWidth, initialDepth, initialLayout)));
  const initialReadOnly = initialScene.client_status === 'configured' && !isAdminViewer;
  const [selectedId, setSelectedId] = useState(initialReadOnly ? null : 'table-1');
  const [draggingId, setDraggingId] = useState(null);
  const [language, setLanguage] = useState(initialOptions.language || 'fr');
  const [headerPanel, setHeaderPanel] = useState(null);
  const [activeStep, setActiveStep] = useState(initialReadOnly ? 4 : 1);
  const [openOptions, setOpenOptions] = useState({ moquette: false, empreinte: false, coton: false, led: false, reserve: false, tete: false, comptoir: false });
  const [selectedCarpetId, setSelectedCarpetId] = useState(initialOptions.carpetColorId || '1893');
  const [selectedCarpetFootprintId, setSelectedCarpetFootprintId] = useState(initialOptions.carpetFootprintColorId || initialOptions.carpetColorId || '1893');
  const [carpetFootprintEnabled, setCarpetFootprintEnabled] = useState(initialOptions.carpetFootprintEnabled !== false);
  const [selectedWallFabricId, setSelectedWallFabricId] = useState(initialOptions.wallFabricColorId || '303');
  const [ledRailsEnabled, setLedRailsEnabled] = useState(initialOptions.ledRailsEnabled !== false);
  const [ledRailOverrides, setLedRailOverrides] = useState(initialOptions.ledRailOverrides || {});
  const [reserveOptionType, setReserveOptionType] = useState(initialOptions.reserveOptionType || (initialOptions.reserveUpgradeEnabled ? '__legacy__' : ''));
  const [partitionHeadChoice, setPartitionHeadChoice] = useState({
    left: hasOwn(initialOptions, 'partitionHeadLeftEnabled') ? Boolean(initialOptions.partitionHeadLeftEnabled) : null,
    right: hasOwn(initialOptions, 'partitionHeadRightEnabled') ? Boolean(initialOptions.partitionHeadRightEnabled) : null,
  });
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const [saveState, setSaveState] = useState(initialScene.client_status || 'not_started');
  const [confirmState, setConfirmState] = useState({ loading: false, message: '', error: '' });
  const [itemOptionState, setItemOptionState] = useState({ uploading: false, error: '' });
  const [itemConfigModal, setItemConfigModal] = useState(null);
  const [clientInfo, setClientInfo] = useState({
    client: initialScene.client_name || '',
    project: initialScene.project_name || '',
    event: initialScene.event_name || initialScene.salon || '',
  });
  const [contactDetails, setContactDetails] = useState(() => ({
    firstName: 'Julien',
    lastName: 'BOURLIEU',
    company: initialScene.client_name || 'Aérosys Industries',
    role: 'Responsable commercial',
    email: initialScene.client_email || 'contact@aerosys.fr',
    phone: '+33 6 12 34 56 78',
    address: '12 avenue de la Défense',
    zip: '92400',
    city: 'Courbevoie',
    country: 'France',
    salon: `${initialScene.salon || 'SMCL 2026'} — Paris-Le Bourget`,
    hall: '1',
    emplacement: (initialScene.project_name || 'Stand A-14').replace(/^Stand\s+/i, ''),
  }));
  const [questionCategory, setQuestionCategory] = useState('technical');
  const [urgency, setUrgency] = useState('important');
  const [questionForm, setQuestionForm] = useState({ subject: '', message: '' });
  const [objectBank, setObjectBank] = useState([]);
  const [objectBankLoaded, setObjectBankLoaded] = useState(false);
  const [viewAngle] = useState(35);
  const hasMounted = useRef(false);

  const area = width * depth;
  const selectedCarpetColor = carpetColors.find((color) => color.id === selectedCarpetId) || carpetColors[0];
  const selectedCarpetFootprintColor = carpetColors.find((color) => color.id === selectedCarpetFootprintId) || selectedCarpetColor;
  const selectedWallFabricColor = wallFabricColors.find((color) => color.id === selectedWallFabricId) || wallFabricColors[0];
  const salonLabel = initialScene.salon || clientInfo.event || 'SMCL 2026';
  const standLabel = initialScene.project_name || clientInfo.project || 'Stand A-14';
  const clientLabel = clientInfo.client || contactDetails.company || 'Aerosys Industries';
  const faceLabel = layout === 'u' ? '3 faces ouvertes' : layout === 'back' ? '1 face ouverte' : '2 faces ouvertes';
  const selectedLanguage = languages.find((entry) => entry.id === language) || languages[0];
  const readOnly = saveState === 'configured' && !isAdminViewer;
  const sceneVisualContext = useMemo(() => ({
    language,
    company: sceneExhibitorCompanyName(initialScene, clientInfo, contactDetails),
    standNumber: sceneStandNumber(initialScene, contactDetails, standLabel),
    hall: sceneHallLabel(initialScene, contactDetails),
  }), [language, initialScene, clientInfo, contactDetails, standLabel]);

  useEffect(() => {
    setItems((current) => current.map((item) => constrainItem(item, width, depth, layout, carpetFootprintEnabled)));
  }, [width, depth, layout, carpetFootprintEnabled]);

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
      .filter((asset) => assetMatchesSalon(asset, salonLabel))
      .map((asset) => assetToCatalogEntry(asset, objectBank));
    const entries = [...dynamicEntries, ...nativeCatalogEntries()];
    return entries.filter((entry, index, all) => all.findIndex((item) => item.type === entry.type) === index);
  }, [objectBank, salonLabel]);
  const placeableCatalog = useMemo(
    () => availableCatalog.filter((entry) => isAdminViewer || !entry.dimensions?.adminOnly),
    [availableCatalog, isAdminViewer],
  );
  const hydratedItems = useMemo(() => (
    objectBankLoaded ? items.map((item) => hydrateSceneItemFromCatalog(item, availableCatalog)) : items
  ), [items, availableCatalog, objectBankLoaded]);
  const manualHydratedItems = useMemo(() => hydratedItems.filter((item) => !isAutomaticLedRailItem(item) && !isAutomaticReserveItem(item) && !isAutomaticPartitionHeadItem(item)), [hydratedItems]);
  const ledRailEntry = useMemo(() => availableCatalog.find(isLedRailEntry), [availableCatalog]);
  const ledSpotCount = ledSpotCountForArea(area);
  const reserveRules = useMemo(() => sceneReserveRules(initialScene), [initialScene]);
  const activeReserveRuleConfig = useMemo(() => activeReserveRule(reserveRules, area), [reserveRules, area]);
  const effectiveReserveOptionType = reserveOptionType === '__legacy__' ? normalizeComplementaryOptions(activeReserveRuleConfig?.options)[0]?.type || '' : reserveOptionType;
  const partitionHeadRules = useMemo(() => scenePartitionHeadRules(initialScene), [initialScene]);
  const activePartitionHeadRuleConfig = useMemo(() => activePartitionHeadRule(partitionHeadRules, area, layout), [partitionHeadRules, area, layout]);
  const effectivePartitionHeadSides = useMemo(() => partitionHeadEnabledSides(activePartitionHeadRuleConfig, partitionHeadChoice), [activePartitionHeadRuleConfig, partitionHeadChoice]);
  const automaticReserveItems = useMemo(
    () => makeAutomaticReserveItems(activeReserveRuleConfig, effectiveReserveOptionType, availableCatalog, width, depth, layout, salonLabel),
    [activeReserveRuleConfig, effectiveReserveOptionType, availableCatalog, width, depth, layout, salonLabel],
  );
  const automaticPartitionHeadItems = useMemo(
    () => makeAutomaticPartitionHeadItems(activePartitionHeadRuleConfig, effectivePartitionHeadSides, availableCatalog, width, depth, layout, salonLabel),
    [activePartitionHeadRuleConfig, effectivePartitionHeadSides, availableCatalog, width, depth, layout, salonLabel],
  );
  const automaticLedItems = useMemo(
    () => (ledRailsEnabled
      ? makeAutomaticLedRailItems(ledRailEntry, width, depth, layout, ledSpotCount)
        .map((item) => applyLedRailOverride(item, ledRailOverrides, width, depth, layout))
      : []),
    [ledRailsEnabled, ledRailEntry, width, depth, layout, ledSpotCount, ledRailOverrides],
  );
  const sceneItems = useMemo(() => [...manualHydratedItems, ...automaticReserveItems, ...automaticPartitionHeadItems, ...automaticLedItems], [manualHydratedItems, automaticReserveItems, automaticPartitionHeadItems, automaticLedItems]);
  const sceneTextureLoad = useSceneTexturePreload(sceneItems, [
    selectedCarpetColor.image,
    carpetFootprintEnabled ? selectedCarpetFootprintColor.image : '',
    selectedWallFabricColor.image,
  ]);
  const sceneAssetsReady = objectBankLoaded && sceneTextureLoad.ready;
  const sceneCanvasClassName = [
    draggingId ? 'dragging-canvas' : '',
    !sceneAssetsReady ? 'scene-canvas-loading' : '',
  ].filter(Boolean).join(' ');
  const selected = sceneItems.find((item) => item.id === selectedId);

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
  }), [area, availableCatalog, sceneItems, salonLabel, initialScene]);
  const estimatedTotal = scenePricing.total;

  const currentScenePayload = (status, clientStatus) => {
    const options = {
      carpetColorId: selectedCarpetColor.id,
      carpetColorName: selectedCarpetColor.name,
      carpetColorHex: selectedCarpetColor.hex,
      carpetFootprintColorId: selectedCarpetFootprintColor.id,
      carpetFootprintColorName: selectedCarpetFootprintColor.name,
      carpetFootprintColorHex: selectedCarpetFootprintColor.hex,
      carpetFootprintEnabled,
      wallFabricColorId: selectedWallFabricColor.id,
      wallFabricColorName: selectedWallFabricColor.name,
      wallFabricColorHex: selectedWallFabricColor.hex,
      language,
      ledRailsEnabled,
      ledSpotCount,
      ledRailOverrides,
      reserveOptionType: effectiveReserveOptionType,
      partitionHeadLeftEnabled: effectivePartitionHeadSides.left,
      partitionHeadRightEnabled: effectivePartitionHeadSides.right,
    };

    return {
      ...initialScene,
      status,
      client_status: clientStatus,
      client_name: clientInfo.client,
      project_name: clientInfo.project,
      event_name: clientInfo.event,
      dimensions: { width, depth, height },
      layout,
      items: manualHydratedItems,
      options,
      source_payload: {
        ...(initialScene.source_payload || {}),
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
  }, [width, depth, height, layout, manualHydratedItems, clientInfo, selectedCarpetColor, selectedCarpetFootprintColor, carpetFootprintEnabled, selectedWallFabricColor, language, ledRailsEnabled, ledSpotCount, ledRailOverrides, effectiveReserveOptionType, effectivePartitionHeadSides, saveState, readOnly]);

  useEffect(() => {
    listObjectBank()
      .then((assets) => setObjectBank(assets || []))
      .catch((error) => console.error('Object bank load failed', error))
      .finally(() => setObjectBankLoaded(true));
  }, []);

  const validateConfiguration = async () => {
    if (readOnly || confirmState.loading) return;
    setConfirmState({ loading: true, message: '', error: '' });
    try {
      await saveScene(currentScenePayload('configured', 'configured'));
      setSaveState('configured');
      setSelectedId(null);
      setDraggingId(null);
      setActiveStep(4);
      setConfirmState({ loading: false, message: 'Votre scène est confirmée. Elle est maintenant verrouillée.', error: '' });
    } catch (error) {
      setConfirmState({ loading: false, message: '', error: error.message || 'Confirmation impossible.' });
    }
  };

  const toggleOption = (key) => {
    setOpenOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  const updateItem = (id, patch) => {
    if (readOnly) return;
    const currentItem = sceneItems.find((item) => item.id === id);
    if (!isAdminViewer && hasOwn(patch, 'rotation') && itemRotationLocked(currentItem)) return;
    const autoLedItem = sceneItems.find((item) => item.id === id && isAutomaticLedRailItem(item));
    if (autoLedItem) {
      const constrained = constrainItem({ ...autoLedItem, ...patch }, width, depth, layout, carpetFootprintEnabled);
      setLedRailOverrides((current) => ({
        ...current,
        [id]: pickLedRailOverride(constrained),
      }));
      return;
    }
    setItems((current) => {
      const blockers = [...automaticReserveItems, ...automaticPartitionHeadItems].filter((item) => item.id !== id);
      const updated = updateSceneItemWithCollision([...current, ...blockers], id, patch, width, depth, layout, carpetFootprintEnabled);
      return updated.filter((item) => !isAutomaticReserveItem(item));
    });
  };

  const updateSelectedItemOptions = (patch) => {
    if (!selected || readOnly) return;
    updateItem(selected.id, { options: { ...(selected.options || {}), ...patch } });
  };

  const uploadSelectedItemImage = async (file, optionKeys = {}) => {
    if (!selected || !file) return;
    const urlKey = optionKeys.urlKey || 'headMainImageUrl';
    const nameKey = optionKeys.nameKey || 'headMainImageName';
    setItemOptionState({ uploading: true, error: '' });
    try {
      const imageUrl = await uploadSceneItemOptionImage(initialScene, selected, file);
      updateSelectedItemOptions({ [urlKey]: imageUrl, [nameKey]: file.name });
      setItemOptionState({ uploading: false, error: '' });
    } catch (error) {
      setItemOptionState({ uploading: false, error: error.message || 'Upload impossible.' });
    }
  };

  const openAddItemConfigurator = (entry) => {
    if (readOnly) return;
    setItemConfigModal({ mode: 'add', entry });
  };

  const openSelectedItemConfigurator = () => {
    if (!selected || readOnly) return;
    const entry = selected.options?.variantGroupType
      ? findCatalogEntry(availableCatalog, selected.options.variantGroupType)
      : findCatalogEntry(availableCatalog, selected.type);
    setItemConfigModal({ mode: 'edit', item: selected, entry });
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
      const nextBase = { ...makeItem(entry.type, width, depth, layout, entry), id: item.id, options };
      const samePlacementMode = isWallItem(item) === isWallItem(nextBase);
      const compatiblePosition = samePlacementMode
        ? {
          ...(isWallItem(nextBase)
            ? { wall: item.wall, x: item.x, y: isTelevisionItem(nextBase) ? screenCenterHeight : item.y, z: item.z }
            : { x: item.x, z: item.z }),
          ...((isAdminViewer || !itemRotationLocked(nextBase)) ? { rotation: item.rotation } : {}),
        }
        : {};
      const candidate = constrainItem({ ...nextBase, ...compatiblePosition }, width, depth, layout, carpetFootprintEnabled);
      const others = current.filter((sceneItem) => sceneItem.id !== item.id);
      const blockers = [...others, ...automaticReserveItems, ...automaticPartitionHeadItems];
      const placed = collidesWithScene(candidate, blockers, candidate.id, width, depth)
        ? placeItemInFreeSpot(candidate, blockers, width, depth, layout, carpetFootprintEnabled)
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
        const placed = placeItemInFreeSpot(item, [...next, ...automaticReserveItems, ...automaticPartitionHeadItems], width, depth, layout, carpetFootprintEnabled);
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
    setItems((current) => current.map((item) => constrainItem(item, width, depth, nextLayout, carpetFootprintEnabled)));
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
      setReserveOptionType('');
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

  const validateContactDetails = () => {
    updateClientInfo('client', contactDetails.company);
    updateClientInfo('project', `Stand ${contactDetails.emplacement}`);
    updateClientInfo('event', contactDetails.salon);
    setHeaderPanel(null);
  };

  const submitQuestion = (event) => {
    event.preventDefault();
    setQuestionForm({ subject: '', message: '' });
    setHeaderPanel(null);
  };

  if (!objectBankLoaded) return <div className="loading-screen">Chargement des objets 3D...</div>;

  return (
    <main className={`configurator-shell ${activeStep === 1 ? 'intro-step' : ''} ${readOnly ? 'readonly-mode' : ''}`}>
      <header className="configurator-topbar">
        <a className="config-logo" href="/">
          <img src="/images/logo.png" alt="Stand-ING" />
        </a>
        <div className="config-breadcrumb">
          <span>{salonLabel}</span>
          <span>{standLabel}</span>
          <span>{area.toFixed(0)} m²</span>
        </div>
        <nav className="stepper" aria-label="Etapes de configuration">
          {[
            { id: 1, label: 'Accueil' },
            { id: 2, label: 'Options' },
            { id: 3, label: 'Mobilier' },
            { id: 4, label: 'Validation' },
          ].map((step) => (
            <button key={step.id} className={activeStep === step.id ? 'active' : step.id < activeStep ? 'done' : ''} onClick={() => setActiveStep(step.id)}>
              <span>{step.id < activeStep ? <Check size={13} /> : step.id}</span>
              {step.label}
            </button>
          ))}
        </nav>
        <div className="top-estimate">
          <strong>{estimatedTotal.toLocaleString('fr-FR')} € HT</strong>
          <span>Total HT estimé</span>
        </div>
        <button className={`round-tool ${headerPanel === 'question' ? 'active' : ''}`} type="button" onClick={() => toggleHeaderPanel('question')} aria-label="Questions et remarques">
          <HelpCircle size={18} />
        </button>
        <button className={`language-pill ${headerPanel === 'language' ? 'active' : ''}`} type="button" onClick={() => toggleHeaderPanel('language')} aria-label="Choisir la langue">
          <span className="flag-dot">{selectedLanguage.flag}</span>
          {selectedLanguage.short}
          <ChevronDown size={15} />
        </button>
        <button className={`user-pill ${headerPanel === 'client' ? 'active' : ''}`} type="button" onClick={() => toggleHeaderPanel('client')} aria-label="Renseignements client">VD</button>
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
            category={questionCategory}
            urgency={urgency}
            form={questionForm}
            onCategoryChange={setQuestionCategory}
            onUrgencyChange={setUrgency}
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
          <ambientLight intensity={0.85} />
          <directionalLight position={[3, 7, 4]} intensity={1.65} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center>Chargement</Html>}>
            {sceneAssetsReady && (
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
                canEditLockedItems={isAdminViewer}
                onDragMove={moveDraggedItem}
                viewAngle={viewAngle}
                carpetColor={selectedCarpetColor}
                carpetFootprintColor={selectedCarpetFootprintColor}
                carpetFootprintEnabled={carpetFootprintEnabled}
                wallFabricColor={selectedWallFabricColor}
                visualContext={sceneVisualContext}
              />
            )}
            <ContactShadows opacity={0.22} scale={12} blur={2.4} far={5} position={[0, -0.01, 0]} />
          </Suspense>
          <OrbitControls
            makeDefault
            target={[0, 0.7, 0]}
            minPolarAngle={Math.PI / 5.2}
            maxPolarAngle={Math.PI / 2.25}
            minDistance={4}
            maxDistance={11}
            enablePan
            enabled={!draggingId}
          />
        </Canvas>

        {!sceneAssetsReady && <SceneTextureLoaderOverlay loaded={objectBankLoaded ? sceneTextureLoad.loaded : 0} total={objectBankLoaded ? sceneTextureLoad.total : 1} />}

        {readOnly && !headerPanel && (
          <div className="readonly-badge">
            <Check size={15} /> Scène confirmée — mode visualisation
          </div>
        )}

        {activeStep > 1 && !headerPanel && scenePricing.baseUsage?.length > 0 && (
          <div className="base-pack-scene-note">
            <strong>Pack de base</strong>
            {scenePricing.baseUsage.slice(0, 4).map((item) => (
              <span key={item.type}>{basePackItemLabel(item.label, item.quantity)} {basePackIncludedWord(item.label, item.quantity)} {item.used}/{item.quantity}</span>
            ))}
          </div>
        )}

        {activeStep === 1 && !headerPanel && !readOnly && (
          <div className="intro-overlay">
            <article className="intro-card" aria-label="Accueil configurateur">
              <div className="intro-card-head">
                <h1>Stand·ING — Configurateur 3D</h1>
                <span>{salonLabel} · {standLabel}</span>
              </div>
              <div className="intro-card-body">
                <h2>Bienvenue, {clientLabel} 👋</h2>
                <p>
                  Votre espace de configuration est prêt. Renseignez les informations
                  de votre stand pour démarrer la visualisation 3D en temps réel.
                </p>
                <ul>
                  <li><span>🏛</span>{standLabel} · Hall 1 · {faceLabel}</li>
                  <li><span>📐</span>{area.toFixed(0)} m² — récupéré depuis votre dossier SMCL</li>
                  <li><span>📅</span>{salonLabel} · 14-18 octobre 2026</li>
                </ul>
                <button type="button" onClick={() => setActiveStep(2)}>
                  Commencer la configuration →
                </button>
              </div>
            </article>
          </div>
        )}

        {selected && !readOnly && (
          <div className="view-toolbar selection-mode" aria-label="Actions objet selectionne">
            <button type="button" disabled={itemPlacementLocked(selected) || (!isAdminViewer && itemRotationLocked(selected))} onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
            <button type="button" disabled={isAutomaticReserveItem(selected)} onClick={openSelectedItemConfigurator} title="Paramètres"><Settings2 size={16} /></button>
            {(isPartitionHeadItem(selected) || isPosterItem(selected)) && <button type="button" onClick={() => setRotationPanelOpen(false)} title="Options visuel"><FileImage size={16} /></button>}
            <button type="button" disabled={!isAdminViewer && itemDeletionLocked(selected)} onClick={deleteSelectedItem} title="Supprimer"><Trash2 size={16} /></button>
            {!isAdminViewer && itemMovementLocked(selected) && <span className="toolbar-lock-note">Déplacement verrouillé</span>}
            {!isAdminViewer && itemRotationLocked(selected) && <span className="toolbar-lock-note">Rotation verrouillée</span>}
            {!isAdminViewer && itemDeletionLocked(selected) && <span className="toolbar-lock-note">Suppression verrouillée</span>}
            {rotationPanelOpen && !isWallItem(selected) && !itemPlacementLocked(selected) && (isAdminViewer || !itemRotationLocked(selected)) && (
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

        {selected && !readOnly && isPartitionHeadItem(selected) && (
          <PartitionHeadOptionsPanel
            item={selected}
            visualContext={sceneVisualContext}
            uploadState={itemOptionState}
            onImageChange={(file) => uploadSelectedItemImage(file)}
            onResetImage={() => updateSelectedItemOptions({ headMainImageUrl: '', headMainImageName: '' })}
          />
        )}

        {selected && !readOnly && isPosterItem(selected) && (
          <PosterOptionsPanel
            item={selected}
            items={sceneItems}
            width={width}
            depth={depth}
            uploadState={itemOptionState}
            onImageChange={(file) => uploadSelectedItemImage(file, { urlKey: 'posterImageUrl', nameKey: 'posterImageName' })}
            onResetImage={() => updateSelectedItemOptions({ posterImageUrl: '', posterImageName: '' })}
          />
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
            onConfigureItem={(item) => setItemConfigModal({ mode: 'edit', item, entry: findCatalogEntry(availableCatalog, item.type) })}
            onNext={() => setActiveStep(4)}
          />
        ) : activeStep === 4 ? (
          <ValidationStepPanel
            area={area}
            layout={layout}
            standLabel={initialScene.project_name || 'Stand A-14'}
            carpetColor={selectedCarpetColor}
            carpetFootprintColor={selectedCarpetFootprintColor}
            carpetFootprintEnabled={carpetFootprintEnabled}
            wallFabricColor={selectedWallFabricColor}
            ledRailsEnabled={ledRailsEnabled}
            ledSpotCount={ledSpotCount}
            reserveRule={activeReserveRuleConfig}
            reserveOptionType={effectiveReserveOptionType}
            partitionHeadRule={activePartitionHeadRuleConfig}
            partitionHeadSides={effectivePartitionHeadSides}
            pricing={scenePricing}
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
            carpetFootprintEnabled={carpetFootprintEnabled}
            selectedWallFabricColor={selectedWallFabricColor}
            ledRailsEnabled={ledRailsEnabled}
            ledSpotCount={ledSpotCount}
            reserveRule={activeReserveRuleConfig}
            reserveOptionType={effectiveReserveOptionType}
            partitionHeadRule={activePartitionHeadRuleConfig}
            partitionHeadSides={effectivePartitionHeadSides}
            salonLabel={salonLabel}
            catalog={availableCatalog}
            readOnly={readOnly}
            onCarpetColor={(colorId) => !readOnly && setSelectedCarpetId(colorId)}
            onCarpetFootprintColor={(colorId) => !readOnly && setSelectedCarpetFootprintId(colorId)}
            onCarpetFootprintEnabled={(enabled) => !readOnly && setCarpetFootprintEnabled(enabled)}
            onWallColor={(colorId) => !readOnly && setSelectedWallFabricId(colorId)}
            onLedRailsEnabled={(enabled) => !readOnly && setLedRailsEnabled(enabled)}
            onReserveOption={(type) => !readOnly && setReserveOptionType(type)}
            onPartitionHeadSide={(side, enabled) => !readOnly && setPartitionHeadChoice((current) => ({ ...current, [side]: enabled }))}
            onExport={() => exportTechnicalPng({ width, depth, layout, items: sceneItems, catalog: availableCatalog })}
          />
        )}
      </aside>
      )}

      {itemConfigModal && (
        <ItemConfiguratorModal
          mode={itemConfigModal.mode}
          entry={itemConfigModal.entry}
          item={itemConfigModal.item}
          salonLabel={salonLabel}
          onClose={closeItemConfigurator}
          onConfirm={confirmItemConfigurator}
        />
      )}

      {activeStep > 1 && activeStep !== 3 && !readOnly && (
      <footer className="configurator-footer">
        <div>
          <span>Total HT estimé</span>
          <strong>{estimatedTotal.toLocaleString('fr-FR')} €</strong>
        </div>
        <nav>
          <button type="button" onClick={() => setActiveStep((step) => Math.max(1, step - 1))}>← Retour</button>
          {activeStep < 4 && <button type="button" onClick={() => setActiveStep((step) => Math.min(4, step + 1))}>Etape suivante →</button>}
        </nav>
      </footer>
      )}
    </main>
  );
}

function ModalHead({ icon, title, salonLabel, onClose }) {
  return (
    <header className="modal-head">
      <div className="modal-title-group">
        {icon && <span className="modal-title-icon">{icon}</span>}
        <h2>{title}</h2>
      </div>
      <div className="modal-head-actions">
        <span>{salonLabel}</span>
        <button type="button" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
      </div>
    </header>
  );
}

function ClientInfoModal({ salonLabel, contactDetails, onChange, onClose, onValidate }) {
  return (
    <section className="client-info-modal">
      <ModalHead title="Renseignements" salonLabel={salonLabel} onClose={onClose} />
      <div className="client-info-content">
        <p>Ces informations seront associées à votre configuration et à votre BAT.</p>
        <div className="form-grid two">
          <label>Prénom<input value={contactDetails.firstName} onChange={(event) => onChange('firstName', event.target.value)} /></label>
          <label>Nom<input value={contactDetails.lastName} onChange={(event) => onChange('lastName', event.target.value)} /></label>
        </div>
        <label className="form-row">Société<input value={contactDetails.company} onChange={(event) => onChange('company', event.target.value)} /></label>
        <div className="form-grid two">
          <label>Fonction<input value={contactDetails.role} onChange={(event) => onChange('role', event.target.value)} /></label>
          <label>Email<input type="email" value={contactDetails.email} onChange={(event) => onChange('email', event.target.value)} /></label>
        </div>
        <label className="form-row">Téléphone<input value={contactDetails.phone} onChange={(event) => onChange('phone', event.target.value)} /></label>

        <span className="form-section-label">Localisation</span>
        <label className="form-row">Adresse<input value={contactDetails.address} onChange={(event) => onChange('address', event.target.value)} /></label>
        <div className="form-grid two">
          <label>Code postal<input value={contactDetails.zip} onChange={(event) => onChange('zip', event.target.value)} /></label>
          <label>Ville<input value={contactDetails.city} onChange={(event) => onChange('city', event.target.value)} /></label>
        </div>
        <label className="form-row">Pays
          <select value={contactDetails.country} onChange={(event) => onChange('country', event.target.value)}>
            <option>France</option>
            <option>Belgique</option>
            <option>Suisse</option>
            <option>Luxembourg</option>
          </select>
        </label>

        <span className="form-section-label">Emplacement</span>
        <label className="form-row locked-field">Salon<input value={contactDetails.salon} readOnly /><span>🔒</span></label>
        <div className="form-grid two locked">
          <label>Hall<input value={contactDetails.hall} readOnly /></label>
          <label>Emplacement<input value={contactDetails.emplacement} readOnly /></label>
        </div>
        <small>Les prix affichés sont hors taxes. Ces informations sont transmises à Stand-ING pour la gestion de votre dossier.</small>
        <button className="modal-primary-button" type="button" onClick={onValidate}>Valider</button>
      </div>
    </section>
  );
}

function QuestionModal({ salonLabel, category, urgency, form, onCategoryChange, onUrgencyChange, onFormChange, onClose, onSubmit }) {
  return (
    <form className="question-modal" onSubmit={onSubmit}>
      <ModalHead icon={<HelpCircle size={19} />} title="Questions / Remarques" salonLabel={salonLabel} onClose={onClose} />
      <div className="question-content">
        <p>Vous avez une question sur votre stand ou souhaitez ajouter une remarque particulière ? L'équipe Stand-ING vous répond sous 24h.</p>

        <span className="form-section-label">Catégorie</span>
        <div className="chip-grid">
          {questionCategories.map((entry) => (
            <button key={entry.id} className={category === entry.id ? 'active' : ''} type="button" onClick={() => onCategoryChange(entry.id)}>
              <span>{entry.icon}</span>{entry.label}
            </button>
          ))}
        </div>

        <label className="form-row">Objet
          <input value={form.subject} onChange={(event) => onFormChange('subject', event.target.value)} placeholder="Ex : Dimension des cloisons pour mon logo..." />
        </label>

        <span className="form-section-label">Niveau d'urgence</span>
        <div className="urgency-grid">
          {urgencyLevels.map((entry) => (
            <button key={entry.id} className={urgency === entry.id ? 'active' : ''} type="button" onClick={() => onUrgencyChange(entry.id)}>
              <span style={{ background: entry.color }} />
              <strong>{entry.label}</strong>
              <small>{entry.delay}</small>
              {urgency === entry.id && <Check size={14} />}
            </button>
          ))}
        </div>

        <label className="form-row">Message
          <textarea
            value={form.message}
            onChange={(event) => onFormChange('message', event.target.value)}
            maxLength={500}
            placeholder={"Décrivez votre question ou remarque en détail...\n\nEx : Pour mon stand 25m², j'aimerais savoir si je peux intégrer un écran LED de 80cm sur la cloison de fond, en plus du visuel textile inclus."}
          />
          <em>{form.message.length} / 500</em>
        </label>

        <span className="form-section-label">Pièces jointes (optionnel)</span>
        <label className="file-drop">
          <Paperclip size={18} />
          <span>Glisser un fichier ou</span>
          <strong>Parcourir</strong>
          <small>PNG, JPG, PDF — Max 10 Mo</small>
          <input type="file" />
        </label>

        <div className="question-note">ℹ️ Notre équipe vous répondra directement par email et mettra à jour votre configuration si nécessaire.</div>
        <button className="modal-primary-button centered" type="submit"><Mail size={15} /> Envoyer ma question</button>
        <button className="modal-cancel-button" type="button" onClick={onClose}>Annuler</button>
      </div>
    </form>
  );
}

function LanguageMenu({ language, onSelect }) {
  return (
    <section className="language-menu" onMouseDown={(event) => event.stopPropagation()}>
      <h3>Choisir la langue</h3>
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
      <p>Les textes du stand restent en français</p>
    </section>
  );
}

function PartitionHeadOptionsPanel({ item, visualContext, uploadState, onImageChange, onResetImage }) {
  const imageName = item.options?.headMainImageName || `Texture originale ${partitionHeadMainImageMaterial(item)}.jpg`;
  return (
    <aside className="item-options-panel">
      <div className="item-options-heading">
        <FileImage size={17} />
        <div>
          <strong>Tête de cloison</strong>
          <span>Options de cet objet uniquement</span>
        </div>
      </div>

      <div className="item-dynamic-preview">
        <span className="preview-flag">{languageFlag(visualContext?.language)}</span>
        <strong>{visualContext?.company || 'Nom société'}</strong>
        <span>{visualContext?.standNumber || 'A-14'}</span>
      </div>

      <label className="item-image-upload">
        <span>Image à modifier</span>
        <small>{imageName}</small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploadState.uploading}
          onChange={(event) => onImageChange(event.target.files?.[0])}
        />
      </label>

      {item.options?.headMainImageUrl && (
        <button className="item-image-reset" type="button" onClick={onResetImage}>Revenir à l’image d’origine</button>
      )}
      {uploadState.uploading && <p className="item-options-status">Upload du visuel...</p>}
      {uploadState.error && <p className="item-options-error">{uploadState.error}</p>}
    </aside>
  );
}

function PosterOptionsPanel({ item, items, width, depth, uploadState, onImageChange, onResetImage }) {
  const imageName = item.options?.posterImageName || 'Aucune image personnalisée';
  const printSize = posterSurfaceRegion(item, items, width, depth);
  const recommendedSpec = recommendedSimulatorImageSpec(printSize.width, printSize.height);
  const imageQuality = useSimulatorImageQualityCheck(item.options?.posterImageUrl, recommendedSpec);
  return (
    <aside className="item-options-panel">
      <div className="item-options-heading">
        <FileImage size={17} />
        <div>
          <strong>Affiche murale</strong>
          <span>Visuel affiché sur toute la surface disponible</span>
        </div>
      </div>

      <div className="poster-format-spec">
        <strong>Format conseillé pour le simulateur</strong>
        <span>Zone affichée : {recommendedSpec.sizeText}</span>
        <span>Image conseillée : {recommendedSpec.pixelText}</span>
        <small>Ratio à respecter : {recommendedSpec.ratioText} · fichier léger JPG, PNG ou WebP</small>
      </div>

      {item.options?.posterImageUrl && (
        <div className="poster-image-preview">
          <img src={item.options.posterImageUrl} alt="Aperçu affiche" />
        </div>
      )}

      {item.options?.posterImageUrl && imageQuality && (
        <div className={`poster-print-quality ${imageQuality.level}`}>
          <strong>{imageQuality.label}</strong>
          <span>{imageQuality.pixelText} importés · conseillé {recommendedSpec.pixelText}</span>
          <small>{imageQuality.detailText}</small>
        </div>
      )}

      <label className="item-image-upload">
        <span>Image de l’affiche</span>
        <small>{imageName}</small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploadState.uploading}
          onChange={(event) => onImageChange(event.target.files?.[0])}
        />
      </label>

      {item.options?.posterImageUrl && (
        <button className="item-image-reset" type="button" onClick={onResetImage}>Retirer l’image personnalisée</button>
      )}
      {uploadState.uploading && <p className="item-options-status">Upload du visuel...</p>}
      {uploadState.error && <p className="item-options-error">{uploadState.error}</p>}
    </aside>
  );
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
      const label = level === 'good' ? 'Qualité simulateur OK' : level === 'warning' ? 'Image un peu faible' : 'Image trop petite';
      setQuality({
        level,
        label,
        detailText: level === 'good'
          ? 'Cette image est adaptée au rendu 3D. Le fichier HD print sera transmis séparément.'
          : 'Pour un meilleur aperçu 3D, importez une image plus proche du format conseillé.',
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
  carpetFootprintEnabled,
  selectedWallFabricColor,
  ledRailsEnabled,
  ledSpotCount,
  reserveRule,
  reserveOptionType,
  partitionHeadRule,
  partitionHeadSides,
  salonLabel,
  catalog,
  readOnly = false,
  onCarpetColor,
  onCarpetFootprintColor,
  onCarpetFootprintEnabled,
  onWallColor,
  onLedRailsEnabled,
  onReserveOption,
  onPartitionHeadSide,
  onExport,
}) {
  return (
    <>
      <PanelHead title="Options de configuration" step={activeStep} />
      <StandSummary area={area} layout={layout} standLabel={standLabel} />
      <RulesSummary ledSpotCount={ledSpotCount} ledRailsEnabled={ledRailsEnabled} reserveRule={reserveRule} partitionHeadRule={partitionHeadRule} />

      <section className="panel-section-title">Les options</section>
      <OptionAccordion title="Moquette" icon={<Layers size={16} />} open={openOptions.moquette} onToggle={() => toggleOption('moquette')}>
        <ColorOptionCard
          title="Couleur"
          colors={carpetColors}
          selectedColor={selectedCarpetColor}
          optionLabel="En option 36€"
          disabled={readOnly}
          onSelect={onCarpetColor}
        />
      </OptionAccordion>
      <OptionAccordion title="Empreinte moquette" icon={<Layers size={16} />} open={openOptions.empreinte} onToggle={() => toggleOption('empreinte')}>
        <ToggleOptionCard
          enabled={carpetFootprintEnabled}
          enabledLabel="La laisser"
          disabledLabel="La retirer"
          disabled={readOnly}
          onChange={onCarpetFootprintEnabled}
        />
        <ColorOptionCard
          title="Couleur empreinte"
          colors={carpetColors}
          selectedColor={selectedCarpetFootprintColor}
          optionLabel="En option 36€"
          disabled={readOnly}
          onSelect={onCarpetFootprintColor}
        />
      </OptionAccordion>
      <OptionAccordion title="Coton cloison" icon={<Box size={16} />} open={openOptions.coton} onToggle={() => toggleOption('coton')}>
        <ColorOptionCard
          title="Couleur"
          colors={wallFabricColors}
          selectedColor={selectedWallFabricColor}
          optionLabel="En option 36€"
          disabled={readOnly}
          onSelect={onWallColor}
        />
      </OptionAccordion>
      <OptionAccordion title="Spots LED" icon={<Sparkles size={16} />} open={openOptions.led} onToggle={() => toggleOption('led')}>
        <LedRailOptionCard
          enabled={ledRailsEnabled}
          spotCount={ledSpotCount}
          disabled={readOnly}
          onChange={onLedRailsEnabled}
        />
      </OptionAccordion>
      <OptionAccordion title="Reserve" icon={<Layers size={16} />} open={openOptions.reserve} onToggle={() => toggleOption('reserve')}>
        <ReserveOptionCard
          rule={reserveRule}
          selectedOptionType={reserveOptionType}
          catalog={catalog}
          salonLabel={salonLabel}
          disabled={readOnly}
          onChange={onReserveOption}
        />
      </OptionAccordion>
      <OptionAccordion title="Tete de cloison" icon={<Ruler size={16} />} open={openOptions.tete} onToggle={() => toggleOption('tete')}>
        <PartitionHeadOptionCard
          rule={partitionHeadRule}
          sides={partitionHeadSides}
          catalog={catalog}
          salonLabel={salonLabel}
          disabled={readOnly}
          onChange={onPartitionHeadSide}
        />
      </OptionAccordion>
      <OptionAccordion title="Comptoir" icon={<Box size={16} />} open={openOptions.comptoir} onToggle={() => toggleOption('comptoir')} />

      <button className="wide export" onClick={onExport}>
        <FileImage size={16} /> Generer PNG technique
      </button>
    </>
  );
}

function FurnitureStepPanel({ items, catalog, pricing, salonLabel, selectedId, readOnly = false, onAdd, onRemove, onSelectItem, onConfigureItem, onNext }) {
  const [activeCategory, setActiveCategory] = useState('all');
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
    return matchesCategory;
  });
  const shopItems = items.filter((item) => !isAutomaticLedRailItem(item) && shopCartItemVisible(item));
  const total = pricing?.total || 0;

  return (
    <>
      <PanelHead title="Bibliothèque accessoires" step={3} />
      <p className="marketplace-subtitle">Cliquez un accessoire pour le configurer</p>

      <nav className="marketplace-tabs" aria-label="Filtrer les accessoires">
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
          />
        ))}
        {!filteredEntries.length && <div className="marketplace-empty">Aucun accessoire dans cette catégorie.</div>}
      </section>

      <FurnitureCartBar
        items={shopItems}
        catalog={catalog}
        selectedId={selectedId}
        total={total}
        salonLabel={salonLabel}
        readOnly={readOnly}
        onAdd={() => setActiveCategory('all')}
        onSelectItem={onSelectItem}
        onConfigureItem={onConfigureItem}
        onRemove={onRemove}
        onNext={onNext}
      />
    </>
  );
}

function MarketplaceCard({ entry, index, salonLabel, catalog, readOnly, includedCount = 0, billableCount = 0, onAdd }) {
  const Icon = entry.icon || Box;
  const price = marketplaceStartingPrice(entry, catalog, salonLabel);
  const category = marketCategoryMeta(normalizeMarketCategory(entry));
  const badge = includedCount > 0 ? `× ${includedCount} au stand` : (index === 1 ? '🔥 Populaire' : '');
  return (
    <article className="marketplace-card">
      <div className="marketplace-card-preview">
        {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <Icon size={42} />}
        {badge && <span className={`marketplace-badge ${index === 1 ? 'hot' : ''}`}>{badge}</span>}
      </div>
      <div className="marketplace-card-body">
        <strong>{entry.label}</strong>
        <em>{price ? `À partir de ${price.toLocaleString('fr-FR')} €` : 'Inclus / sur devis'}</em>
        <small>{marketplaceItemSubtitle(entry, category.label)}</small>
        <button type="button" disabled={readOnly} onClick={onAdd} aria-label={`Ajouter ${entry.label}`}>
          {billableCount > 0 ? <Check size={16} /> : <Plus size={18} />}
        </button>
      </div>
    </article>
  );
}

function FurnitureCartBar({ items, catalog, selectedId, total, salonLabel, readOnly, onAdd, onSelectItem, onConfigureItem, onRemove, onNext }) {
  return (
    <div className="furniture-cart-bar">
      <div className="cart-total-card">
        <ClockIcon />
        <span>Mon stand</span>
        <small>{items.length} article{items.length > 1 ? 's' : ''} AMCO</small>
        <strong>{total.toLocaleString('fr-FR')} €</strong>
      </div>
      <button type="button" className="cart-add-card" onClick={onAdd} disabled={readOnly}>
        <span><Plus size={18} /></span>
        <strong>Ajouter</strong>
        <small>Choisir dans la bibliothèque</small>
      </button>
      <div className="cart-item-strip">
        {items.map((item) => {
          const entry = findCatalogEntry(catalog, item.type) || item;
          const selected = item.id === selectedId;
          return (
            <button key={item.id} type="button" className={`cart-item-card ${selected ? 'active' : ''}`} onClick={() => onSelectItem(item.id)}>
              <span className="cart-item-thumb">{entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" /> : <Box size={22} />}</span>
              <span>
                <strong>{itemCartLabel(item)}</strong>
                <small>{item.options?.variantLabel || 'Quantité · 1'}</small>
                <em>{cartItemPrice(item, entry, salonLabel).toLocaleString('fr-FR')} €</em>
              </span>
              <span className="cart-item-settings" onClick={(event) => { event.stopPropagation(); onConfigureItem(item); }}>•••</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="cart-next-button" onClick={onNext}>Étape suivante<br /><span>Validation →</span></button>
    </div>
  );
}

function ClockIcon() {
  return <span className="cart-clock">◷</span>;
}

function ItemConfiguratorModal({ mode, entry, item, salonLabel, onClose, onConfirm }) {
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
  const basePrice = selectedVariant?.price ?? assetUnitPrice(catalogEntry, salonLabel);
  const extras = extraOptions.reduce((sum, option) => sum + (selectedExtras[option.id] ? Number(option.price || 0) : 0), 0);
  const total = (basePrice + extras) * (mode === 'add' ? quantity : 1);

  const toggleExtra = (id, checked) => {
    setSelectedExtras((current) => ({ ...current, [id]: checked }));
  };

  const submit = () => {
    const resolvedEntry = selectedVariant?.entry || catalogEntry;
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
        variantAssetType: selectedVariant?.assetType,
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
            <h2>{mode === 'add' ? `Configurer ${itemConfigTitle(catalogEntry)}` : `Paramétrer ${itemConfigTitle(catalogEntry)}`}</h2>
            <span>Bibliothèque › {marketCategoryMeta(normalizeMarketCategory(catalogEntry)).label} › {catalogEntry.label}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </header>

        <div className="item-config-product">
          <span>{catalogEntry.thumbnailUrl ? <img src={catalogEntry.thumbnailUrl} alt="" /> : <Box size={34} />}</span>
          <div>
            <strong>{catalogEntry.label}</strong>
            <small>Réf. {assetReference(selectedVariant?.entry || catalogEntry, salonLabel) || selectedVariant?.assetType || catalogEntry.type || 'Stand-ING'}</small>
          </div>
        </div>

        <ConfigChoiceGrid title="Variante" choices={variants} value={format} onChange={setFormat} />

        {extraOptions.length > 0 && (
          <div className="item-config-options">
            {extraOptions.map((option) => (
              <ToggleOption
                key={option.id}
                active={Boolean(selectedExtras[option.id])}
                label={option.label}
                detail={option.detail}
                price={`+ ${Number(option.price || 0).toLocaleString('fr-FR')} €`}
                onChange={(checked) => toggleExtra(option.id, checked)}
              />
            ))}
          </div>
        )}

        {mode === 'add' && (
          <div className="item-config-quantity">
            <span>Quantité</span>
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
            <strong>{quantity}</strong>
            <button type="button" onClick={() => setQuantity((value) => value + 1)}>+</button>
          </div>
        )}

        <footer>
          <div>
            <span>Total cet article</span>
            <strong>{total.toLocaleString('fr-FR')} €</strong>
            {quantity > 1 && <small>{quantity} × {(basePrice + extras).toLocaleString('fr-FR')} €</small>}
          </div>
          <button type="button" onClick={submit}>{mode === 'add' ? '+ Ajouter au stand' : 'Enregistrer'}</button>
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
    const groupVariants = normalizeVariantGroupOptions(entry?.dimensions?.variantAssets, salonLabel);
    if (groupVariants.length) return groupVariants;
  }
  return genericItemVariants(entry, salonLabel);
}

function itemConfigExtraOptions(entry) {
  return normalizeAssetConfigOptions(entry?.dimensions?.configOptions);
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
    }))
    .filter((option) => option.label.trim());
}

function normalizeVariantGroupOptions(variantAssets = [], salonLabel = '') {
  if (!Array.isArray(variantAssets)) return [];
  return variantAssets
    .filter((entry) => entry?.type)
    .map((entry, index) => ({
      id: entry.type,
      assetType: entry.type,
      label: entry.label || `Variante ${index + 1}`,
      detail: entry.dimensions?.variantDetail || assetDimensionsLabel({ dimensions: entry.dimensions }) || '',
      price: assetUnitPrice(entry, salonLabel),
      reference: assetReference(entry, salonLabel),
      imageUrl: entry.thumbnailUrl || entry.thumbnail_url || '',
      isDefault: index === 0,
      entry,
    }));
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
  return Number(item.options?.unitPrice ?? assetUnitPrice(entry, salonLabel) ?? 0);
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
  const label = `${item.type || ''} ${item.label || ''}`.toLowerCase();
  return !label.includes('spot led');
}

function ValidationStepPanel({
  area,
  layout,
  standLabel,
  carpetColor,
  carpetFootprintColor,
  carpetFootprintEnabled,
  wallFabricColor,
  ledRailsEnabled,
  ledSpotCount,
  reserveRule,
  reserveOptionType,
  partitionHeadRule,
  partitionHeadSides,
  pricing,
  saveState,
  confirmState,
  readOnly,
  isAdminViewer,
  onConfirm,
}) {
  const lines = pricing?.lines || [];
  const baseItems = pricing?.baseUsage || pricing?.baseItems || [];
  const confirmed = saveState === 'configured';
  const reserveOption = reserveOptionType ? normalizeComplementaryOptions(reserveRule?.options).find((option) => option.type === reserveOptionType) : null;

  return (
    <>
      <PanelHead title="Validation" step={4} />
      <StandSummary area={area} layout={layout} standLabel={standLabel} />

      <section className="validation-summary-card">
        <h2>Récapitulatif HT</h2>
        <div className="validation-total-line">
          <span>Total options et mobilier</span>
          <strong>{(pricing?.total || 0).toLocaleString('fr-FR')} € HT</strong>
        </div>
        <p>La scène de base est incluse à 0 €. Seuls les ajouts hors pack ou au-delà des quantités incluses sont facturés.</p>
      </section>

      <section className="validation-section">
        <h3>Options choisies</h3>
        <div className="validation-option-row"><span>Moquette</span><strong>{carpetColor.name} ({carpetColor.code})</strong></div>
        <div className="validation-option-row"><span>Empreinte moquette</span><strong>{carpetFootprintEnabled ? `${carpetFootprintColor.name} (${carpetFootprintColor.code})` : 'Retirée'}</strong></div>
        <div className="validation-option-row"><span>Coton cloison</span><strong>{wallFabricColor.name} ({wallFabricColor.code})</strong></div>
        <div className="validation-option-row"><span>Spots LED</span><strong>{ledRailsEnabled ? `${ledSpotCount} spots conserves` : 'Retires'}</strong></div>
        <div className="validation-option-row"><span>Réserve</span><strong>{reserveOption?.label || reserveRule?.includedLabel || 'Non incluse'}</strong></div>
        <div className="validation-option-row"><span>Têtes de cloison</span><strong>{partitionHeadSummary(partitionHeadRule, partitionHeadSides)}</strong></div>
      </section>

      <section className="validation-section">
        <h3>Objets inclus dans le pack</h3>
        {baseItems.length ? (
          baseItems.map((item) => (
            <div key={item.type} className="validation-option-row">
              <span>{basePackItemLabel(item.label, item.quantity)}</span>
              <strong>{item.used ?? 0}/{item.quantity}</strong>
            </div>
          ))
        ) : (
          <p className="validation-muted">Aucun quota mobilier configuré sur ce pack.</p>
        )}
      </section>

      <section className="validation-section">
        <h3>Suppléments facturés</h3>
        {lines.length ? (
          lines.map((line) => (
            <div key={line.type} className="validation-price-row">
              <span>{line.label} × {line.quantity}</span>
              <strong>{line.total.toLocaleString('fr-FR')} € HT</strong>
            </div>
          ))
        ) : (
          <p className="validation-muted">Aucun supplément : la configuration reste à 0 € HT.</p>
        )}
      </section>

      {confirmState.message && <div className="validation-message success">{confirmState.message}</div>}
      {confirmState.error && <div className="validation-message error">{confirmState.error}</div>}

      {confirmed && !isAdminViewer ? (
        <div className="validation-locked"><Check size={16} /> Scène confirmée, mode visualisation activé.</div>
      ) : (
        <button className="validation-confirm-button" type="button" disabled={readOnly || confirmState.loading} onClick={onConfirm}>
          {confirmState.loading ? 'Confirmation...' : confirmed ? 'Scène confirmée' : 'Confirmer la scène'}
        </button>
      )}
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
  return (
    <div className="config-panel-head">
      <h1>{title}</h1>
      <span>Etape {step} / 4</span>
    </div>
  );
}

function StandSummary({ area, layout, standLabel }) {
  return (
    <div className="stand-summary-card">
      <strong>{area.toFixed(0)} m2 · {layout === 'u' ? '3 faces' : layout === 'back' ? '1 face' : '2 faces'} · {standLabel}</strong>
    </div>
  );
}

function RulesSummary({ ledSpotCount, ledRailsEnabled, reserveRule, partitionHeadRule }) {
  return (
    <div className="rules-card">
      <strong>Regles SMCL appliquees automatiquement</strong>
      <span>{reserveRule?.includedType ? '✓' : '−'} {reserveRule?.includedLabel || 'Pas de réserve incluse'}</span>
      <span>✓ {partitionHeadRule?.includedCount || 0} tete{(partitionHeadRule?.includedCount || 0) > 1 ? 's' : ''} de cloison incluse{(partitionHeadRule?.includedCount || 0) > 1 ? 's' : ''}</span>
      <span>{ledRailsEnabled ? '✓' : '−'} {ledSpotCount} spots LED (1/3m2)</span>
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
  return (
    <div className="led-option-card">
      <div>
        <strong>Rails LED automatiques</strong>
        <span>{spotCount} spots calcules automatiquement, soit 1 spot tous les 3m2.</span>
      </div>
      <div className="led-option-actions">
        <button
          type="button"
          className={enabled ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(true)}
        >
          Les laisser
        </button>
        <button
          type="button"
          className={!enabled ? 'active danger' : ''}
          disabled={disabled}
          onClick={() => onChange(false)}
        >
          Tous les retirer
        </button>
      </div>
      <small>Ils sont places en haut des murs et restent inclus dans la scene de base.</small>
    </div>
  );
}

function ReserveOptionCard({ rule, selectedOptionType = '', catalog = [], salonLabel = '', disabled = false, onChange }) {
  const options = normalizeComplementaryOptions(rule?.options || []);
  if (!rule?.includedType && !options.length) {
    return (
      <div className="reserve-option-card">
        <strong>Aucune réserve configurée</strong>
        <span>Cette surface ne déclenche pas de réserve automatique ni d’option complémentaire.</span>
      </div>
    );
  }

  const includedEntry = findCatalogEntry(catalog, rule.includedType);
  const includedSelected = !selectedOptionType;

  return (
    <div className="reserve-option-card">
      {rule?.includedType ? (
        <button
          type="button"
          className={includedSelected ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange('')}
        >
          <span>
            {rule.includedLabel || includedEntry?.label || 'Réserve incluse'}
            <em>Incluse dans la scène de départ · 0 € HT</em>
          </span>
          {includedSelected ? <Check size={16} /> : <Plus size={16} />}
        </button>
      ) : (
        <div>
          <strong>Pas de réserve incluse</strong>
          <span>Tu peux choisir une option payante ci-dessous.</span>
        </div>
      )}

      {options.length ? options.map((option) => {
        const entry = findCatalogEntry(catalog, option.type);
        const selected = selectedOptionType === option.type;
        const price = reserveOptionPrice(option, entry, salonLabel);
        return (
          <button
            type="button"
            key={option.type}
            className={selected ? 'active' : ''}
            disabled={disabled}
            onClick={() => onChange(selected && !rule?.includedType ? '' : option.type)}
          >
            <span>
              {option.label || entry?.label || 'Réserve complémentaire'}
              <em>{selected ? 'Option sélectionnée' : `+ ${price.toLocaleString('fr-FR')} € HT`}</em>
            </span>
            {selected ? <Check size={16} /> : <Plus size={16} />}
          </button>
        );
      }) : <small>Aucune option complémentaire configurée sur ce pack.</small>}
    </div>
  );
}

function PartitionHeadOptionCard({ rule, sides = {}, catalog = [], salonLabel = '', disabled = false, onChange }) {
  const rows = [
    { side: 'left', label: 'Tête de cloison gauche', type: rule?.leftType, price: rule?.leftPrice },
    { side: 'right', label: 'Tête de cloison droite', type: rule?.rightType, price: rule?.rightPrice },
  ];

  return (
    <div className="reserve-option-card">
      {rows.map((row) => {
        const entry = findCatalogEntry(catalog, row.type);
        const selected = Boolean(sides?.[row.side]);
        const previewSides = selected ? sides : { ...sides, [row.side]: true };
        const billable = partitionHeadBillableSides(rule, previewSides).has(row.side);
        const price = billable ? firstPriceValue(row.price, assetUnitPrice(entry, salonLabel), 0) : 0;
        return (
          <button
            key={row.side}
            type="button"
            className={selected ? 'active' : ''}
            disabled={disabled || !row.type}
            onClick={() => onChange(row.side, !selected)}
          >
            <span>
              {row.label}
              <em>{row.type ? (billable ? `+ ${price.toLocaleString('fr-FR')} € HT` : 'Inclus · 0 € HT') : 'Non configurée'}</em>
            </span>
            {selected ? <Check size={16} /> : <Plus size={16} />}
          </button>
        );
      })}
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

function ColorOptionCard({ title, colors, selectedColor, optionLabel, disabled = false, onSelect }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const includedColors = colors.filter((color) => color.included);
  const optionalColors = colors.filter((color) => !color.included);
  const selectColor = (colorId) => {
    if (disabled) return;
    onSelect(colorId);
    setDropdownOpen(false);
  };

  return (
    <div className="color-option-card">
      <div className="color-card-head">
        <strong>{title}</strong>
        <span>{selectedColor.name} ({selectedColor.code})</span>
      </div>
      <div className={`color-dropdown ${dropdownOpen ? 'open' : ''}`}>
        <button className="color-dropdown-trigger" type="button" disabled={disabled} onClick={() => setDropdownOpen((open) => !open)}>
          <span className="selected-swatch" style={{ '--swatch-color': selectedColor.hex, '--swatch-image': `url("${selectedColor.image}")` }} />
          <span>
            <strong>{selectedColor.name}</strong>
            <small>{selectedColor.code} · {selectedColor.included ? 'Inclus' : optionLabel}</small>
          </span>
          <ChevronDown size={18} />
        </button>
        {dropdownOpen && (
          <div className="color-dropdown-menu">
            <small>{includedColors.length} coloris disponibles — Inclus</small>
            <div className="color-swatch-row included">
              {includedColors.map((color) => (
                <button
                  key={color.id}
                  className={selectedColor.id === color.id ? 'active' : ''}
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
                  className={selectedColor.id === color.id ? 'active' : ''}
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
          </div>
        )}
      </div>
    </div>
  );
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
      setSyncState({
        loading: false,
        message: `${result?.processed ?? 0} scene(s) synchronisee(s), ${result?.clients ?? 0} exposant(s) traite(s) depuis Monday.`,
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
            />
          )}
          {tab === 'monday' && <AdminMondayView syncState={syncState} runMondaySync={runMondaySync} />}
          {tab === 'bat' && <AdminBatView scenes={scenes} />}
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
      salon: scene.event_name || scene.salon || 'Salon à définir',
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

function getSalonRows(scenes) {
  const grouped = scenes.reduce((acc, scene) => {
    const key = scene.event_name || scene.salon || 'Salon à définir';
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
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible d’activer ce pack.' });
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
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible d’ouvrir ce pack.' });
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
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible d’ouvrir le pack de base.' });
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
      setActionState({ loadingPack: '', savingBoardPack: '', savingBasePack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible d’enregistrer le board Monday.' });
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
      .filter((asset) => assetMatchesSalon(asset, salon?.name))
      .map((asset) => assetToCatalogEntry(asset, assets));
    const all = [...dynamicEntries, ...nativeCatalogEntries()];
    return all
      .filter((entry, index) => all.findIndex((item) => item.type === entry.type) === index)
      .filter((entry) => isBasePackEligible(entry));
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
            <p>Les objets placés ici composent la scène de départ selon l’implantation. Les quotas gratuits se règlent dans “Pack de base”.</p>
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
      .filter((asset) => assetMatchesSalon(asset, salon.name))
      .map((asset) => assetToCatalogEntry(asset, assets));
    const entries = [...dynamicEntries, ...nativeCatalogEntries()];
    return entries.filter((entry, index, all) => all.findIndex((item) => item.type === entry.type) === index);
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
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const [reserveRules, setReserveRules] = useState(() => normalizeReserveRules(preset.base_config?.reserveRules || preset.base_config?.options?.reserveRules, { keepEmptyOptions: true }));
  const [partitionHeadRules, setPartitionHeadRules] = useState(() => normalizePartitionHeadRules(preset.base_config?.partitionHeadRules || preset.base_config?.options?.partitionHeadRules));
  const presetTextureLoad = useSceneTexturePreload(items, []);
  const selected = items.find((item) => item.id === selectedId);

  useEffect(() => {
    setItems((current) => current.map((item) => constrainItem(hydrateSceneItemFromCatalog(item, availableCatalog), width, depth, layout)));
  }, [width, depth, layout, availableCatalog]);

  useEffect(() => {
    setReserveRules(normalizeReserveRules(preset.base_config?.reserveRules || preset.base_config?.options?.reserveRules, { keepEmptyOptions: true }));
    setPartitionHeadRules(normalizePartitionHeadRules(preset.base_config?.partitionHeadRules || preset.base_config?.options?.partitionHeadRules));
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
      options: { presetMode: true, includedPack: offer?.name, salon: salon.name, reserveRules: cleanedReserveRules, partitionHeadRules },
    });
  };

  return (
    <div className="preset-editor-grid">
      <section className="preset-3d-stage">
        <Canvas
          camera={{ position: [4.5, 4.2, 5.7], fov: 48 }}
          className={!presetTextureLoad.ready ? 'scene-canvas-loading' : ''}
          shadows
          onPointerUp={() => setDraggingId(null)}
          onPointerLeave={() => setDraggingId(null)}
        >
          <color attach="background" args={['#eef0f4']} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[3, 7, 4]} intensity={1.65} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center>Chargement</Html>}>
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
              canEditLockedItems
              onDragMove={moveDraggedItem}
              viewAngle={35}
              carpetColor={{ hex: '#bebebe' }}
              wallFabricColor={{ hex: '#f8f7f3' }}
            />
            <ContactShadows opacity={0.22} scale={12} blur={2.4} far={5} position={[0, -0.01, 0]} />
          </Suspense>
          <OrbitControls makeDefault target={[0, 0.7, 0]} minPolarAngle={Math.PI / 5.2} maxPolarAngle={Math.PI / 2.25} minDistance={4} maxDistance={11} enablePan enabled={!draggingId} />
        </Canvas>

        {!presetTextureLoad.ready && <SceneTextureLoaderOverlay loaded={presetTextureLoad.loaded} total={presetTextureLoad.total} />}

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
        <p>Cette base est spécifique à l’implantation {layoutLabel(layout)}. Change d’onglet pour configurer les autres murs.</p>
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
      <p>Le nombre inclus dépend de la surface. Dans l’étape 2, l’exposant coche gauche/droite ; tout dépassement devient payant.</p>
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
                Placée d’office à la génération
                <select value={includedSideValue} onChange={(event) => updateBand(band.id, { includedSides: event.target.value ? [event.target.value] : [] })}>
                  <option value="">À choisir</option>
                  <option value="left">Tête gauche</option>
                  <option value="right">Tête droite</option>
                </select>
              </label>
            )}
            {includedCount >= 2 && <div className="preset-reserve-empty">Gauche + droite incluses et placées d’office.</div>}
            {includedCount <= 0 && <div className="preset-reserve-empty">Aucune tête placée d’office, les coches seront payantes.</div>}
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
  const salons = [...new Set((client.scenes || []).map((scene) => scene.event_name || scene.salon).filter(Boolean))];
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

function AdminObjectsView({ assets, scenes, search, category, selectedAsset, uploadState, onCategoryChange, onSelectAsset, onCloseAsset, onSaveAsset, onDeleteAsset, onUploadAssetFolder }) {
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [variantGroupCreatorOpen, setVariantGroupCreatorOpen] = useState(false);
  const categories = ['Tout', 'Groupes', 'Groupes de variantes', ...assetCategoryOptions];
  const filteredAssets = assets.filter((asset) => {
    const assetCategory = assetCategoryLabel(asset);
    const matchesCategory = category === 'Tout' || assetCategory === category;
    const matchesSearch = !search || [asset.label, asset.type, assetCategory].filter(Boolean).some((value) => value.toLowerCase().includes(search.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <section className="admin-assets-view">
      <div className="asset-actions-row">
        <label className="asset-upload-drop">
          <Upload size={23} />
          <span>Ajouter un dossier OBJ complet</span>
          <strong>{uploadState?.loading ? 'Import en cours...' : 'Parcourir un dossier'}</strong>
          <small>Le dossier doit contenir l’OBJ, son .MTL et les textures. Les chemins relatifs sont conservés.</small>
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
      </div>
      {(uploadState?.message || uploadState?.error) && (
        <div className={`asset-upload-feedback ${uploadState.error ? 'error' : ''}`}>
          {uploadState.error || uploadState.message}
        </div>
      )}

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
  const [groupRows, setGroupRows] = useState(() => assetToGroupRows(asset));
  const [selectedGroupRowUid, setSelectedGroupRowUid] = useState(null);
  const salons = getSalonRows(scenes).map((salon) => salon.title);
  const assignedSalons = assetSalons(draft, scenes);
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
  const draftCeilingMounted = Boolean(draft.dimensions?.ceilingMounted);
  const draftMovementLocked = Boolean(draft.dimensions?.movementLocked);
  const draftDeleteLocked = Boolean(draft.dimensions?.deleteLocked);
  const draftRotationLocked = Boolean(draft.dimensions?.rotationLocked);
  const draftConfigOptions = normalizeAssetConfigOptions(draft.dimensions?.configOptions);
  const [variantAssetTypes, setVariantAssetTypes] = useState(() => draft.dimensions?.variantAssetTypes || []);

  useEffect(() => {
    setDraft(asset);
    setThumbnailUploading(false);
    setThumbnailError('');
    setGroupRows(assetToGroupRows(asset));
    setVariantAssetTypes(asset.dimensions?.variantAssetTypes || []);
    setSelectedGroupRowUid(null);
  }, [asset]);

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

  const updateConfigOptionRow = (index, patch) => {
    const nextRows = draftConfigOptions.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const nextRow = { ...row, ...patch };
      if (patch.label !== undefined && patch.id === undefined) nextRow.id = slugForType(patch.label || row.id || `option-${index + 1}`);
      return nextRow;
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

  const updateTelevisionOption = (checked) => {
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        isTelevision: checked,
        ...(checked ? { mountType: 'wall', wallY: screenCenterHeight, ceilingMounted: false } : {}),
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
        ...(checked ? { mountType: 'floor', isTelevision: false } : {}),
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
    if (isVariantGroup) {
      onSave({
        ...draft,
        label: draft.label?.trim() || 'Groupe de variantes',
        dimensions: {
          ...(draft.dimensions || {}),
          isVariantGroup: true,
          category: draft.dimensions?.category || 'Mobilier',
          variantAssetTypes: variantAssetTypes.filter(Boolean),
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
      label: draft.label?.trim() || 'Groupe d’objets',
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
      setThumbnailError(error.message || 'Upload de l’image impossible.');
    } finally {
      setThumbnailUploading(false);
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
            <strong>{thumbnailUploading ? 'Image en cours d’envoi...' : 'Image de l’objet'}</strong>
            <small>{draft.thumbnail_url ? 'Remplacer l’image qui représente cet objet.' : 'Ajouter une image pour représenter cet objet.'}</small>
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

        <label className="asset-group-field">
          <span>Nom</span>
          <input value={draft.label || ''} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
        </label>

        {!isGroupAsset && (
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

        {!isVariantGroup && (
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
          <label className="asset-toggle-row">
            <input
              type="checkbox"
              checked={draftCeilingMounted}
              onChange={(event) => updateCeilingMountedOption(event.target.checked)}
            />
            <span>
              <strong>Objet au plafond</strong>
              <small>Place le bas de l’objet à 3,00 m de hauteur, avec déplacement libre en X/Z.</small>
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
              <small>L’exposant pourra sélectionner l’objet, mais pas le déplacer.</small>
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
              <small>L’exposant ne pourra pas supprimer cet objet depuis sa scène.</small>
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
              <small>L’exposant pourra sélectionner l’objet, mais pas changer son angle.</small>
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
                <small>Chaque option s’affichera dans la popup comme une ligne activable avec supplément HT.</small>
              </div>
              <button type="button" onClick={addConfigOptionRow}><Plus size={14} /> Option</button>
            </div>
            <AssetConfigOptionRows
              rows={draftConfigOptions}
              emptyLabel="Aucune option payante configurée."
              onChange={updateConfigOptionRow}
              onRemove={removeConfigOptionRow}
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
          {(salons.length ? salons : ['SMCL 2026', 'SIAE 2026']).map((salon) => {
            const active = assignedSalons.includes(salon);
            const salonPricing = getSalonPricing(draft, salon);
            return (
              <div key={salon} className="asset-salon-pricing-row">
                <button type="button" onClick={() => toggleSalon(salon)}>
                  <strong>{salon}</strong>
                  <span>{active ? 'Actif' : 'Inactif'}</span>
                  <i className={active ? 'active' : ''} />
                </button>
                {active && !isVariantGroup && (
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
              </div>
            );
          })}
        </section>

        {isGroupAsset && (
          <>
            <section className="asset-group-builder">
              <h3>Composition du groupe</h3>
              <p>Tu peux modifier les objets, leur position X/Z et les déplacer directement sur le mini-plan.</p>
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
                    <label><span>X m</span><input type="number" step="0.10" value={row.x} onChange={(event) => updateGroupRow(row.uid, { x: event.target.value })} /></label>
                    <label><span>Z m</span><input type="number" step="0.10" value={row.z} onChange={(event) => updateGroupRow(row.uid, { z: event.target.value })} /></label>
                    <label><span>Rotation</span><input type="number" step="5" value={row.rotation} onChange={(event) => updateGroupRow(row.uid, { rotation: event.target.value })} /></label>
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
          {isVariantGroup ? 'Le groupe sert uniquement de fiche boutique : les prix et références viennent des objets associés.' : 'Les prix et références peuvent être différents pour chaque salon actif.'}
        </small>

        <footer>
          <button type="button" className="asset-delete" onClick={onDelete}>Supprimer définitivement</button>
          <button type="button" className="asset-save" onClick={saveDraft}>Enregistrer les modifications</button>
        </footer>
      </aside>
    </div>
  );
}

function AssetConfigOptionRows({ rows, emptyLabel, onChange, onRemove }) {
  if (!rows.length) return <p className="asset-variants-empty">{emptyLabel}</p>;
  return (
    <div className="asset-variant-list">
      {rows.map((row, index) => (
        <article key={`${row.id}-${index}`} className="asset-variant-row option-row">
          <label>
            <span>Nom</span>
            <input value={row.label || ''} onChange={(event) => onChange(index, { label: event.target.value })} placeholder="Ex : Technicien 1/2 j" />
          </label>
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
            <span><strong>Cochée par défaut</strong><small>L’option est active à l’ouverture.</small></span>
          </label>
          <button type="button" onClick={() => onRemove(index)} aria-label="Supprimer cette option"><Trash2 size={14} /></button>
        </article>
      ))}
    </div>
  );
}

function AssetVariantSourceRows({ rows, sourceAssets, onChange, onRemove }) {
  if (!sourceAssets.length) return <p className="asset-variants-empty">Aucun objet disponible pour créer des variantes.</p>;
  if (!rows.length) return <p className="asset-variants-empty">Aucun objet associé : ce groupe ne s’affichera pas encore dans la boutique.</p>;
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
  const [assignedSalons, setAssignedSalons] = useState(() => getSalonRows(scenes).map((salon) => salon.title).slice(0, 1));
  const [saving, setSaving] = useState(false);

  const toggleSalon = (salon) => {
    setAssignedSalons((current) => (current.includes(salon) ? current.filter((item) => item !== salon) : [...current, salon]));
  };

  const updateConfigOptionRow = (index, patch) => {
    setConfigOptions((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const nextRow = { ...row, ...patch };
      if (patch.label !== undefined && patch.id === undefined) nextRow.id = slugForType(patch.label || row.id || `option-${index + 1}`);
      return nextRow;
    }));
  };

  const addConfigOptionRow = () => {
    setConfigOptions((current) => [
      ...current,
      { id: `option-${Date.now()}`, label: 'Nouvelle option', detail: '', price: 0, defaultChecked: false },
    ]);
  };

  const saveGroup = async () => {
    if (!rows.filter(Boolean).length) return;
    setSaving(true);
    const cleanRows = [...new Set(rows.filter(Boolean))];
    await onCreate({
      type: `variant-group-${slugForType(name)}-${Date.now().toString(36)}`,
      label: name.trim() || 'Groupe de variantes',
      model_url: null,
      thumbnail_url: null,
      is_active: assignedSalons.length > 0,
      dimensions: {
        isVariantGroup: true,
        category,
        variantAssetTypes: cleanRows,
        configOptions,
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
              <h3>Options payantes</h3>
              <small>Ces lignes seront activables dans la popup et ajouteront leur prix au total.</small>
            </div>
            <button type="button" onClick={addConfigOptionRow}><Plus size={14} /> Option</button>
          </div>
          <AssetConfigOptionRows
            rows={configOptions}
            emptyLabel="Aucune option payante configurée."
            onChange={updateConfigOptionRow}
            onRemove={(index) => setConfigOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          />
        </section>

        <section className="asset-assignment">
          <h3>Affectation par salon</h3>
          {(getSalonRows(scenes).map((salon) => salon.title).length ? getSalonRows(scenes).map((salon) => salon.title) : ['SMCL 2026', 'SIAE 2026']).map((salon) => {
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
      label: name.trim() || 'Groupe d’objets',
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
          <p>Place les objets directement sur le plan en vue du dessus. Les champs X/Z restent disponibles pour l'ajustement précis.</p>
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
                <label><span>X m</span><input type="number" step="0.10" value={row.x} onChange={(event) => updateRow(row.uid, { x: event.target.value })} /></label>
                <label><span>Z m</span><input type="number" step="0.10" value={row.z} onChange={(event) => updateRow(row.uid, { z: event.target.value })} /></label>
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
          {(getSalonRows(scenes).map((salon) => salon.title).length ? getSalonRows(scenes).map((salon) => salon.title) : ['SMCL 2026', 'SIAE 2026']).map((salon) => {
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

function MiniGroupPlan({ rows, sourceAssets, selectedUid, onSelect, onMove }) {
  const svgRef = useRef(null);
  const [draggingUid, setDraggingUid] = useState(null);
  const snapStep = 0.1;
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

function AdminBatView({ scenes }) {
  const rows = scenes.slice(0, 6);
  return (
    <section className="admin-table modern">
      {rows.map((scene) => (
        <article key={scene.id} className="stand-row">
          <div><strong>{scene.client_name || 'Exposant sans nom'}</strong><span>{scene.project_name}</span></div>
          <div><span>Salon</span><strong>{scene.salon}</strong></div>
          <div><span>BAT</span><strong>{fileSummary(scene.files)}</strong></div>
          <div><span>Exposant</span><strong>{clientStatusLabel(scene.client_status)}</strong></div>
          <div className="stand-actions"><a href={sceneShareUrl(scene)}>Voir scene</a></div>
        </article>
      ))}
    </section>
  );
}

function AdminPlaceholder({ tab }) {
  return (
    <section className="admin-placeholder-card">
      <h2>{adminTitle(tab)}</h2>
      <p>La maquette de ce menu sera intégrée dès que tu me l'envoies.</p>
    </section>
  );
}

function sceneArea(scene) {
  const width = Number(scene.dimensions?.width || scene.width_m || 0);
  const depth = Number(scene.dimensions?.depth || scene.depth_m || 0);
  return Math.round(width * depth);
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
  if (diffHours < 1) return 'à l’instant';
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
  if (asset.dimensions?.isVariantGroup) return 'Groupe de variantes';
  if (asset.dimensions?.isGroup) return 'Groupe';
  const url = asset.model_url || '';
  const ext = url.split('.').pop()?.toUpperCase();
  if (ext === 'OBJ' || ext === 'GLB') return ext;
  return asset.model_url ? '3D' : 'Natif';
}

function assetSizeLabel(asset) {
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
  const dynamicAssets = assets.filter((asset) => asset.is_active && !asset.dimensions?.isGroup && !asset.dimensions?.isVariantGroup && !isWallItemType(asset.type));
  const all = [...baseAssets, ...dynamicAssets];
  return all.filter((asset, index) => all.findIndex((candidate) => candidate.type === asset.type) === index);
}

function variantSourceAssets(assets = [], excludedType = '') {
  return assets
    .filter((asset) => asset.type !== excludedType)
    .filter((asset) => asset.is_active)
    .filter((asset) => !asset.dimensions?.isGroup && !asset.dimensions?.isVariantGroup)
    .filter((asset, index, all) => all.findIndex((candidate) => candidate.type === asset.type) === index);
}

function nativeCatalogEntries() {
  return catalog.filter((entry) => !entry.modelUrl && !entry.materialUrl && !entry.isGroup);
}

function assetToGroupRows(asset) {
  return (asset?.dimensions?.children || []).map((child, index) => ({
    uid: `${child.id || child.type || 'child'}-${index}-${Date.now()}`,
    type: child.type,
    label: child.label || '',
    x: Number(child.x || 0),
    z: Number(child.z || 0),
    rotation: Number(child.rotation || 0),
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
        dimensions: source.dimensions || {},
        color: source.dimensions?.color || source.color,
        lockedInGroup: true,
      };
    })
    .filter(Boolean);
}

function assetSalons(asset, scenes = []) {
  if (Array.isArray(asset.dimensions?.salons)) return asset.dimensions.salons;
  const salons = [...new Set(scenes.map((scene) => scene.event_name || scene.salon).filter(Boolean))];
  return asset.is_active ? salons.slice(0, 1) : [];
}

function assetToCatalogEntry(asset, allAssets = []) {
  if (asset.dimensions?.isVariantGroup) {
    const variantAssets = (asset.dimensions?.variantAssetTypes || [])
      .map((type) => allAssets.find((candidate) => candidate.type === type))
      .filter(Boolean)
      .map((candidate) => assetToCatalogEntry(candidate, allAssets));
    return {
      type: asset.type,
      label: asset.label,
      icon: Layers,
      color: asset.dimensions?.color || '#dfe8ec',
      price: Math.min(...variantAssets.map((entry) => assetUnitPrice(entry, assetSalons(asset)[0])).filter((price) => price > 0), 0) || 0,
      thumbnailUrl: asset.thumbnail_url,
      dimensions: {
        ...(asset.dimensions || {}),
        isVariantGroup: true,
        variantAssets,
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
    id: `auto-reserve-${rule.id}-${type}`,
    label: billable
      ? (selectedOption.label || entry.label || 'Réserve complémentaire')
      : (rule.includedLabel || entry.label || 'Réserve incluse'),
    autoReserve: true,
    included: !billable,
    priceMode: billable ? 'billable' : 'included',
    movementLocked: true,
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

function partitionHeadSummary(rule, sides = {}) {
  if (!rule) return 'Non configurées';
  const labels = [];
  if (sides.left) labels.push('gauche');
  if (sides.right) labels.push('droite');
  return labels.length ? labels.join(' + ') : 'Aucune';
}

function calculateScenePricing({ catalog, items, salonLabel, scene }) {
  const basePrice = 0;
  const baseItems = sceneBaseItems(scene);
  const baseItemsConfigured = sceneHasBaseItems(scene);
  const includedSceneCounts = countSceneItems(items.filter(isIncludedSceneItem));
  const baseItemCounts = baseItemsToCountMap(baseItems);
  const includedCounts = baseItemsConfigured
    ? mergeIncludedCountMaps(includedSceneCounts, baseItemCounts)
    : includedSceneCounts;
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
    const itemPrices = billableItems.map((item) => cartItemPrice(item, entry, salonLabel));
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

function collectSceneTextureUrls(items = [], extraUrls = []) {
  const urls = new Set((extraUrls || []).filter(Boolean));
  const visit = (item) => {
    if (!item) return;
    if (item.options?.headMainImageUrl) urls.add(item.options.headMainImageUrl);
    if (item.options?.posterImageUrl) urls.add(item.options.posterImageUrl);

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

function logTextureDiagnostic(message, details = {}) {
  if (!import.meta.env.DEV) return;
  console.warn(message, details);
}

function preloadImage(url, attempt = 0) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ ok: true, url });
      return;
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve({ ok: true, url });
    image.onerror = () => {
      if (attempt < textureRetryAttempts && canRetryTextureUrl(url)) {
        window.setTimeout(() => {
          preloadImage(textureRetryUrl(url, attempt + 1), attempt + 1).then(resolve);
        }, 180 * (attempt + 1));
        return;
      }
      logTextureDiagnostic('Texture preload failed after retries', { url });
      resolve({ ok: false, url });
    };
    image.src = attempt ? textureRetryUrl(url, attempt) : url;
    if (image.complete && image.naturalWidth > 0) resolve({ ok: true, url });
  });
}

function SceneTextureLoaderOverlay({ loaded = 0, total = 0 }) {
  const progress = total ? Math.round((loaded / total) * 100) : 100;
  return (
    <div className="scene-texture-loader" aria-live="polite">
      <div className="scene-texture-loader-card">
        <Sparkles size={20} />
        <strong>Chargement de la scène 3D</strong>
        <span>Préparation des modèles et textures… {progress}%</span>
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
  return Boolean(item?.movementLocked || item?.dimensions?.movementLocked || itemPlacementLocked(item));
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

function ledSpotCountForArea(area) {
  return Math.max(1, Math.ceil(Number(area || 0) / ledSpotAreaMeters));
}

function isLedRailEntry(item = {}) {
  const text = `${item?.type || ''} ${item?.label || ''} ${item?.dimensions?.folderName || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return text.includes('led') && (text.includes('rail') || text.includes('spot'));
}

function isAutomaticLedRailItem(item = {}) {
  return Boolean(item?.autoLedRail || item?.dimensions?.autoLedRail);
}

function isAutomaticReserveItem(item = {}) {
  return Boolean(item?.autoReserve || item?.dimensions?.autoReserve);
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

function makeAutomaticLedRailItems(entry, width, depth, layout, spotCount) {
  if (!entry || !spotCount) return [];
  const railCount = Math.max(1, Math.ceil(spotCount / ledSpotsPerRail(entry)));
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

  return allocations.flatMap((allocation) => {
    const baseItem = {
      ...makeItem(entry.type, width, depth, layout, entry),
      autoLedRail: true,
      included: true,
      priceMode: 'included',
      lockedPlacement: false,
      collisionEnabled: false,
      wall: allocation.wall,
      y: ledRailCenterY(entry),
      dimensions: {
        ...(entry.dimensions || {}),
        autoLedRail: true,
        collisionEnabled: false,
        wallY: ledRailCenterY(entry),
      },
    };
    const range = wallItemAxisRange(baseItem, allocation.wall, width, depth);
    return Array.from({ length: allocation.count }, (_, index) => {
      const rawAxis = range.min + ((index + 1) * (range.max - range.min)) / (allocation.count + 1);
      const axis = clamp(snapWallAxis(rawAxis), range.min, range.max);
      return constrainItem({
        ...baseItem,
        id: `auto-led-${entry.type}-${allocation.wall}-${index + 1}`,
        x: axis,
      }, width, depth, layout);
    });
  });
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
    || mondayColumnText(scene.source_payload, 'n_')
    || contactDetails.emplacement
    || standLabel.replace(/^Stand\s+/i, '')
    || '';
}

function sceneHallLabel(scene = {}, contactDetails = {}) {
  return scene.source_payload?.hall
    || mondayColumnText(scene.source_payload, 'hall')
    || contactDetails.hall
    || 'À définir';
}

function mondayColumnText(sourcePayload = {}, columnId = '') {
  if (!columnId || !Array.isArray(sourcePayload?.column_values)) return '';
  return sourcePayload.column_values.find((column) => column.id === columnId)?.text || '';
}

function languageFlag(language = 'fr') {
  return language === 'en' ? '🇬🇧' : '🇫🇷';
}

function itemCollisionEnabled(item) {
  if (isPosterItem(item)) return false;
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
  const length = wall === 'back' ? width : depth;
  const bounds = wallItemAxisBounds(item, wall);
  return {
    min: -length / 2 - bounds.min,
    max: length / 2 - bounds.max,
  };
}

function wallItemAxisBounds(item, wall = 'back') {
  if (item?.type === 'poster') return { min: -0.25, max: 0.25 };
  const bounds = itemGroupBounds(item);
  if (wall === 'left') {
    return { min: -Number(bounds.maxX || 0), max: -Number(bounds.minX || 0) };
  }
  return { min: Number(bounds.minX || -0.55), max: Number(bounds.maxX || 0.55) };
}

function wallFromDrag(point, currentWall, width, depth, layout) {
  const validWalls = availableWalls(layout).map((wall) => wall.id);
  const current = validWalls.includes(currentWall) ? currentWall : 'back';
  const outsideEdge = 0.08;

  if (current === 'back') {
    if (validWalls.includes('left') && point.x < -width / 2 - outsideEdge) return 'left';
    if (validWalls.includes('right') && point.x > width / 2 + outsideEdge) return 'right';
    return 'back';
  }

  if (current === 'left') {
    if (validWalls.includes('back') && point.z < -depth / 2 - outsideEdge) return 'back';
    if (validWalls.includes('right') && point.x > width / 2 + outsideEdge) return 'right';
    return 'left';
  }

  if (current === 'right') {
    if (validWalls.includes('back') && point.z < -depth / 2 - outsideEdge) return 'back';
    if (validWalls.includes('left') && point.x < -width / 2 - outsideEdge) return 'left';
    return 'right';
  }

  const wallZones = [
    { wall: 'back', active: Math.abs(point.z + depth / 2) <= wallSwitchZone, distance: Math.abs(point.z + depth / 2) },
    { wall: 'left', active: point.x <= -width / 2 + wallSwitchZone, distance: Math.abs(point.x + width / 2) },
    { wall: 'right', active: point.x >= width / 2 - wallSwitchZone, distance: Math.abs(point.x - width / 2) },
  ].filter((zone) => validWalls.includes(zone.wall) && zone.active);

  if (!wallZones.length || wallZones.some((zone) => zone.wall === current)) {
    return current;
  }

  return wallZones.sort((a, b) => a.distance - b.distance)[0].wall;
}

function wallDragPatch(point, dragged, items, width, depth, layout) {
  const fixedY = isTelevisionItem(dragged) ? { y: screenCenterHeight } : {};
  const objectWall = objectWallFromDrag(point, items, dragged.id);
  if (objectWall) {
    return {
      wall: objectWall.surface.id,
      x: objectWall.axis,
      wallSide: isPosterItem(dragged) ? 1 : objectWall.side,
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
  const threshold = 0.35;
  const candidates = objectWallSurfaces(items, ignoreId)
    .map((surface) => {
      const halfLength = surface.length / 2;
      const minAxis = surface.centerAxis - halfLength - 0.3;
      const maxAxis = surface.centerAxis + halfLength + 0.3;
      const axisValue = surface.orientation === 'x' ? point.x : point.z;
      const normalValue = surface.orientation === 'x' ? point.z : point.x;
      if (axisValue < minAxis || axisValue > maxAxis) return null;
      const distance = Math.abs(normalValue - surface.normalAxis);
      if (distance > threshold) return null;
      return {
        surface,
        axis: snapWallAxis(clamp(axisValue, surface.centerAxis - halfLength, surface.centerAxis + halfLength)),
        side: normalValue >= surface.normalAxis ? 1 : -1,
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
  const surfaces = (group.children || [])
    .flatMap((child) => {
      const rotated = rotatePoint(Number(child.x || 0), Number(child.z || 0), groupRotation);
      return wallSurfaceCandidate(
        child,
        `${group.id}:${child.id}`,
        Number(group.x || 0) + rotated.x,
        Number(group.z || 0) + rotated.z,
        groupRotation + Number(child.rotation || 0),
      );
    })
    .filter(Boolean);
  return mergeObjectWallSurfaces(group.id, surfaces);
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
      };
    });
  });
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
  const base = {
    ...item,
    placementRule: rule,
    lockedPlacement: true,
    rotation: Number(rule.rotation || 0),
  };

  if (rule.id === 'back-right' || rule.id === 'outer-right') {
    return {
      ...base,
      x: Number((width / 2 - clearance - bounds.maxX).toFixed(2)),
      z: Number((-depth / 2 + clearance - bounds.minZ).toFixed(2)),
    };
  }

  if (rule.id === 'back-center') {
    return {
      ...base,
      x: Number((-(bounds.minX + bounds.maxX) / 2).toFixed(2)),
      z: Number((-depth / 2 + clearance - bounds.minZ).toFixed(2)),
    };
  }

  if (rule.id === 'front-left') {
    return {
      ...base,
      x: Number((-width / 2 + clearance - bounds.minX).toFixed(2)),
      z: Number((depth / 2 - clearance - bounds.maxZ).toFixed(2)),
    };
  }

  if (rule.id === 'front-right') {
    return {
      ...base,
      x: Number((width / 2 - clearance - bounds.maxX).toFixed(2)),
      z: Number((depth / 2 - clearance - bounds.maxZ).toFixed(2)),
    };
  }

  return {
    ...base,
    x: Number((-width / 2 + clearance - bounds.minX).toFixed(2)),
    z: Number((-depth / 2 + clearance - bounds.minZ).toFixed(2)),
  };
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
  const axis = snapWallAxis(axisByRule[rule.id] ?? range.min);

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

function constrainItem(item, width, depth, layout, carpetFootprintEnabled = true) {
  if (isWallItem(item)) {
    if (isObjectWallId(item.wall)) {
      const surface = item.wallSurface;
      if (surface) {
        const halfLength = surface.length / 2;
        const itemHalfWidth = wallItemMetrics(item, [], width, depth).width / 2;
        const margin = Math.min(itemHalfWidth, Math.max(0, halfLength - 0.02));
        const min = surface.centerAxis - halfLength + margin;
        const max = surface.centerAxis + halfLength - margin;
        return { ...item, x: clamp(snapWallAxis(item.x), min, max), y: wallItemCenterY(item) };
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
  const bounds = itemPlacementBounds(positionedItem);
  const placement = closestPlacementInRegions(positionedItem, placementRegions(width, depth, layout, bounds, carpetFootprintEnabled));

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

  const candidate = constrainItem({ ...currentItem, ...patch }, width, depth, layout, carpetFootprintEnabled);
  if (collidesWithScene(candidate, items, id, width, depth)) return items;
  return items.map((item) => (item.id === id ? candidate : item));
}

function placeItemInFreeSpot(item, items, width, depth, layout, carpetFootprintEnabled = true) {
  const firstCandidate = constrainItem(item, width, depth, layout, carpetFootprintEnabled);
  if (isWallItem(firstCandidate)) return placeWallItemInFreeSpot(firstCandidate, items, width, depth, layout);
  if (itemPlacementLocked(firstCandidate)) return collidesWithScene(firstCandidate, items, firstCandidate.id, width, depth) ? null : firstCandidate;
  if (!collidesWithScene(firstCandidate, items, firstCandidate.id, width, depth)) return firstCandidate;

  const bounds = itemPlacementBounds(firstCandidate);
  const regions = placementRegions(width, depth, layout, bounds, carpetFootprintEnabled);
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
  if (!itemCollisionEnabled(candidate) || isPosterItem(candidate)) return false;
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
  const blocker = floorWallBlocker(item, wall, width, depth);
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
  const bounds = itemPlacementBounds(item);
  const centerX = Number(item.x || 0);
  const centerZ = Number(item.z || 0);

  return {
    minX: centerX + bounds.minX - collisionPadding,
    maxX: centerX + bounds.maxX + collisionPadding,
    minZ: centerZ + bounds.minZ - collisionPadding,
    maxZ: centerZ + bounds.maxZ + collisionPadding,
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

  if (!item.isGroup || !item.children?.length) return itemPlacementBoundsOverride(item) || centeredBounds(itemDefaultSize(item));

  if (item.groupSize?.length >= 3) {
    const childBounds = item.children?.length ? childrenBounds(item.children) : null;
    if (childBounds) return childBounds;
    return centeredBounds(item.groupSize);
  }

  return childrenBounds(item.children) || centeredBounds();
}

function itemPlacementBoundsOverride(item) {
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
  const side = isPosterItem(item) ? 1 : (Number(item.wallSide || 1) >= 0 ? 1 : -1);
  const screenOffset = wallMountedNormalOffset(item, true);
  const region = isPosterItem(item) ? posterObjectSurfaceRegion(item, surface) : null;
  const axis = Number(region?.center ?? item.x ?? surface.centerAxis ?? 0);
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
  if (isPosterItem(item)) return fixedWallHeight / 2;
  if (isLedRailEntry(item)) return ledRailCenterY(item);
  if (isPartitionHeadItem(item)) return 0;
  const y = Number(item?.dimensions?.wallY);
  return Number.isFinite(y) && y >= 0 ? y : 0;
}

function wallMountedNormalOffset(item, objectSurface = false) {
  if (isPosterItem(item)) return (objectSurface ? wallThickness / 2 : wallThickness) + 0.006;
  if (item?.type === 'screen') return wallThickness + screenDepth / 2;
  const depth = Number(itemGroupSize(item)?.depth || item?.wallDepth || itemDefaultSize(item)?.[2] || 0.08);
  return wallThickness + Math.max(0.02, depth / 2);
}

function posterObjectSurfaceRegion(item, surface) {
  const min = Number(surface.centerAxis || 0) - Number(surface.length || 0) / 2;
  const max = Number(surface.centerAxis || 0) + Number(surface.length || 0) / 2;
  return {
    min,
    max,
    center: (min + max) / 2,
    width: Math.max(0.5, Number((max - min).toFixed(2))),
    height: fixedWallHeight,
  };
}

function posterSurfaceRegion(item, items, width, depth) {
  if (isObjectWallId(item?.wall)) {
    const surface = objectWallSurfaceForItem(item, items) || item.wallSurface;
    if (surface) return posterObjectSurfaceRegion(item, surface);
  }

  const wall = item.wall || 'back';
  const wallLength = wall === 'back' ? width : depth;
  const min = -wallLength / 2;
  const max = wallLength / 2;
  const axis = clamp(Number(item.x || 0), min, max);
  const blockers = wallBlockers(item, items, width, depth, wall)
    .map((blocker) => ({ min: clamp(blocker.min, min, max), max: clamp(blocker.max, min, max) }))
    .filter((blocker) => blocker.max > blocker.min)
    .sort((a, b) => a.min - b.min);

  const segments = [];
  let cursor = min;
  blockers.forEach((blocker) => {
    if (blocker.min > cursor) segments.push({ min: cursor, max: blocker.min });
    cursor = Math.max(cursor, blocker.max);
  });
  if (cursor < max) segments.push({ min: cursor, max });

  const containing = segments.find((segment) => axis >= segment.min && axis <= segment.max);
  const nearest = containing || segments.sort((a, b) => Math.abs(axis - (a.min + a.max) / 2) - Math.abs(axis - (b.min + b.max) / 2))[0] || { min, max };
  const segmentMin = nearest.min;
  const segmentMax = nearest.max;
  return {
    min: segmentMin,
    max: segmentMax,
    center: Number(((segmentMin + segmentMax) / 2).toFixed(2)),
    width: Math.max(0.5, Number((segmentMax - segmentMin).toFixed(2))),
    height: fixedWallHeight,
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
      return floorWallBlocker(item, wall, width, depth, margin);
    })
    .filter(Boolean);
}

function wallMountedBlocker(item, wall, width, depth, margin = 0.1) {
  if (!itemCollisionEnabled(item)) return null;
  if ((item.wall || 'back') !== wall) return null;
  const axis = Number(item.x || 0);
  const itemWidth = wallItemMetrics(item, [], width, depth).width;
  return { min: axis - itemWidth / 2 - margin, max: axis + itemWidth / 2 + margin };
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

function StandScene({ width, depth, height, layout, items, selectedId, setSelectedId, draggingId, setDraggingId, onDragMove, viewAngle, carpetColor, carpetFootprintColor, carpetFootprintEnabled = true, wallFabricColor, interactive = true, canEditLockedItems = false, visualContext = null }) {
  const [hoveredId, setHoveredId] = useState(null);
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
    if (!interactive || draggingId) return;
    setHoveredId((current) => (hovered ? itemId : (current === itemId ? null : current)));
  };

  const clearSceneSelection = () => {
    if (!interactive || draggingId) return;
    setHoveredId(null);
    setSelectedId(null);
  };

  return (
    <group position={cameraPivot} onPointerMissed={clearSceneSelection}>
      {interactive && <DragSurface width={width} depth={depth} layout={layout} carpetFootprintEnabled={carpetFootprintEnabled} sceneOffset={cameraPivot} draggingId={draggingId} onDragMove={onDragMove} onClearHover={() => setHoveredId(null)} onDeselect={clearSceneSelection} />}
      <Floor width={width} depth={depth} layout={layout} carpetColor={carpetColor} carpetFootprintColor={carpetFootprintColor} carpetFootprintEnabled={carpetFootprintEnabled} />
      <Walls width={width} depth={depth} height={height} layout={layout} wallFabricColor={wallFabricColor} onDeselect={clearSceneSelection} />
      <Text position={[0, 0.018, depth / 2 - 0.18]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.15} color="#6b6458">
        {width}m x {depth}m
      </Text>
      {items.map((item) => (
          <SceneItem
          key={item.id}
          item={item}
          items={items}
          width={width}
          depth={depth}
          selected={item.id === selectedId}
          hovered={item.id === hoveredId}
          dragging={item.id === draggingId}
          onSelect={() => interactive && setSelectedId(item.id)}
          onHover={(hovered) => setItemHover(item.id, hovered)}
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
      ))}
    </group>
  );
}

function Floor({ width, depth, layout, carpetColor, carpetFootprintColor, carpetFootprintEnabled = true }) {
  const footprint = rectSize(carpetFootprintBounds(width, depth, layout));
  const carpetTexture = useRepeatedTexture(colorTextureUrl(carpetColor), width, depth);
  const footprintTexture = useRepeatedTexture(colorTextureUrl(carpetFootprintColor || carpetColor), footprint.width, footprint.depth);
  const carpetHex = colorHex(carpetColor, '#bebebe');
  const footprintHex = colorHex(carpetFootprintColor || carpetColor, carpetHex);

  return (
    <group>
      <mesh receiveShadow position={[0, -floorThickness / 2, 0]}>
        <boxGeometry args={[width, floorThickness, depth]} />
        <meshStandardMaterial color={carpetHex} map={carpetTexture || null} roughness={0.82} />
      </mesh>
      {carpetFootprintEnabled && (
        <>
          <mesh receiveShadow position={[footprint.centerX, 0.012, footprint.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[footprint.width, footprint.depth]} />
            <meshStandardMaterial color={footprintHex} map={footprintTexture || null} roughness={0.82} />
          </mesh>
        </>
      )}
    </group>
  );
}

function colorHex(color, fallback = '#bebebe') {
  return typeof color === 'string' ? color : (color?.hex || fallback);
}

function colorTextureUrl(color) {
  return typeof color === 'string' ? '' : (color?.image || '');
}

function useRepeatedTexture(url, width, depth, tileSize = 1) {
  const loadedTexture = useLoader(TextureLoader, url || blankTextureDataUrl);
  const texture = useMemo(() => {
    const seamlessTexture = url ? createSeamlessRepeatedTexture(loadedTexture.image) : loadedTexture.clone();
    seamlessTexture.wrapS = RepeatWrapping;
    seamlessTexture.wrapT = RepeatWrapping;
    seamlessTexture.colorSpace = SRGBColorSpace;
    seamlessTexture.minFilter = LinearMipmapLinearFilter;
    seamlessTexture.magFilter = LinearFilter;
    seamlessTexture.repeat.set(Math.max(1, Number(width || 1) / tileSize), Math.max(1, Number(depth || 1) / tileSize));
    seamlessTexture.needsUpdate = true;
    return seamlessTexture;
  }, [loadedTexture, url, width, depth, tileSize]);

  useEffect(() => () => texture.dispose(), [texture]);

  return url ? texture : null;
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


function DragSurface({ width, depth, layout, carpetFootprintEnabled = true, sceneOffset, draggingId, onDragMove, onClearHover, onDeselect }) {
  const footprint = rectSize(carpetFootprintBounds(width, depth, layout));
  const dragPlane = (key, position, size) => (
    <mesh
      key={key}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={() => {
        if (!draggingId) onDeselect?.();
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        if (!draggingId) {
          onClearHover?.();
          return;
        }
        onDragMove({
          x: event.point.x - sceneOffset[0],
          z: event.point.z - sceneOffset[2],
        });
      }}
      onPointerUp={(event) => {
        if (!draggingId) return;
        event.stopPropagation();
      }}
    >
      <planeGeometry args={size} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );

  return (
    <group>
      {dragPlane('stand', [0, 0.015, 0], [width, depth])}
      {carpetFootprintEnabled && dragPlane('footprint', [footprint.centerX, 0.016, footprint.centerZ], [footprint.width, footprint.depth])}
    </group>
  );
}


function Walls({ width, depth, height, layout, wallFabricColor, onDeselect }) {
  const sideDepth = Math.max(0.01, depth - wallThickness);
  const sideZ = -depth / 2 + wallThickness + sideDepth / 2;
  return (
    <group onPointerDown={() => onDeselect?.()}>
      <Wall position={[0, height / 2, -depth / 2 + wallThickness / 2]} size={[width, height, wallThickness]} color={wallFabricColor} textureWidth={width} textureHeight={height} />
      <Baseboard position={[0, baseboardHeight / 2, -depth / 2 + wallThickness + baseboardThickness / 2]} size={[width, baseboardHeight, baseboardThickness]} />
      {(layout === 'left' || layout === 'u') && <Wall position={[-width / 2 + wallThickness / 2, height / 2, sideZ]} size={[wallThickness, height, sideDepth]} color={wallFabricColor} textureWidth={sideDepth} textureHeight={height} />}
      {(layout === 'left' || layout === 'u') && <Baseboard position={[-width / 2 + wallThickness + baseboardThickness / 2, baseboardHeight / 2, sideZ]} size={[baseboardThickness, baseboardHeight, sideDepth]} />}
      {(layout === 'right' || layout === 'u') && <Wall position={[width / 2 - wallThickness / 2, height / 2, sideZ]} size={[wallThickness, height, sideDepth]} color={wallFabricColor} textureWidth={sideDepth} textureHeight={height} />}
      {(layout === 'right' || layout === 'u') && <Baseboard position={[width / 2 - wallThickness - baseboardThickness / 2, baseboardHeight / 2, sideZ]} size={[baseboardThickness, baseboardHeight, sideDepth]} />}
    </group>
  );
}

function Wall({ position, size, color, textureWidth, textureHeight }) {
  const wallTexture = useRepeatedTexture(colorTextureUrl(color), textureWidth, textureHeight, 1.8);
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={wallTexture ? '#ffffff' : colorHex(color, '#f8f7f3')}
        map={wallTexture || null}
        roughness={1}
        metalness={0}
      />
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
      onPointerOver={(event) => { event.stopPropagation(); onHover(true); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(false); }}
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
      onPointerOver={(event) => { event.stopPropagation(); onHover(true); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(false); }}
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

function SceneItemContent({ item, selected, hovered, dragging, visualContext }) {
  const bounds = itemGroupBounds(item);
  const centerY = isCenterAnchoredWallModel(item) ? 0 : null;
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
  if (item.modelUrl?.toLowerCase().split('?')[0].endsWith('.glb')) return <GlbModel item={item} selected={selected} hovered={hovered} />;
  if (materialUrl) return <ObjModelWithMaterials item={item} materialUrl={materialUrl} selected={selected} hovered={hovered} visualContext={visualContext} />;
  return <ObjModel item={item} selected={selected} hovered={hovered} dragging={dragging} />;
}

function GlbModel({ item, selected, hovered }) {
  const gltf = useLoader(GLTFLoader, item.modelUrl);
  const model = useMemo(() => prepareLoadedModel(gltf.scene, item, { selected, hovered, isGlb: true }), [gltf, item, selected, hovered]);
  return <primitive object={model} dispose={null} />;
}

function ObjModelWithMaterials({ item, materialUrl, selected, hovered, visualContext }) {
  const mainImageTexture = useExternalTexture(isPartitionHeadItem(item) ? item.options?.headMainImageUrl : '', { coverSize: partitionHeadMainImageCoverSize(item) });
  const exhibitorTexture = useMemo(() => (
    isPartitionHeadItem(item) ? createPartitionHeadInfoTexture(visualContext, item) : null
  ), [item.type, item.label, item.modelUrl, visualContext?.language, visualContext?.company, visualContext?.standNumber, visualContext?.hall]);
  const materials = useLoader(MTLLoader, materialUrl, (loader) => {
    const manager = new LoadingManager();
    manager.setURLModifier((url) => resolveModelResourceUrl(url, item));
    loader.manager = manager;
    loader.setMaterialOptions({ ignoreZeroRGBs: true, side: DoubleSide });
    loader.setResourcePath(assetBaseUrl(materialUrl || item.modelUrl));
    const parse = loader.parse.bind(loader);
    loader.parse = (text, path) => parse(rewriteRuntimeMtlReferences(text, item), path);
  });
  const obj = useLoader(OBJLoader, item.modelUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });
  const model = useMemo(() => prepareLoadedModel(obj, item, {
    mainImageTexture,
    exhibitorTexture,
    selected,
    hovered,
  }), [obj, item, mainImageTexture, exhibitorTexture, selected, hovered]);

  return <primitive object={model} dispose={null} />;
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
      child.material = applyVisualStateMaterial(child.material, textureOptions);
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
    const loader = new TextureLoader();
    loader.load(url, (loadedTexture) => {
      if (disposed) {
        loadedTexture.dispose();
        return;
      }
      const nextTexture = options.coverSize ? createCoverImageTexture(loadedTexture.image, options.coverSize[0], options.coverSize[1]) : loadedTexture;
      if (!options.coverSize) prepareDynamicTexture(nextTexture);
      setTexture(nextTexture);
    }, undefined, () => {
      if (!disposed) setTexture(null);
    });

    return () => {
      disposed = true;
    };
  }, [url, options.coverSize?.[0], options.coverSize?.[1]]);

  return texture;
}

function prepareDynamicTexture(texture) {
  texture.flipY = true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createCoverImageTexture(image, targetWidth, targetHeight) {
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
  return prepareDynamicTexture(new CanvasTexture(canvas));
}

function posterCoverTextureSize(region = null, maxLongEdge = 1600) {
  const safeWidth = Math.max(0.001, Number(region?.width || 1));
  const safeHeight = Math.max(0.001, Number(region?.height || 1));
  const ratio = safeWidth / safeHeight;
  if (ratio >= 1) return [maxLongEdge, Math.max(256, Math.round(maxLongEdge / ratio))];
  return [Math.max(256, Math.round(maxLongEdge * ratio)), maxLongEdge];
}

function applyItemOptionMaterials(material, item, textureOptions = {}, meshName = '') {
  if (!isPartitionHeadItem(item)) return material;
  if (Array.isArray(material)) return material.map((entry) => applyItemOptionMaterials(entry, item, textureOptions, meshName));
  if (!material) return material;

  const materialName = normalizeMaterialName(material.name);
  if (textureOptions.mainImageTexture && materialName.includes(partitionHeadMainImageMaterial(item))) {
    return materialWithTexture(material, textureOptions.mainImageTexture);
  }
  if (textureOptions.exhibitorTexture && shouldUseExhibitorHeadTexture(materialName, meshName, item, material)) {
    return materialWithTexture(material, textureOptions.exhibitorTexture);
  }
  return material;
}

function partitionHeadMainImageMaterial(item = {}) {
  return isSmclPartitionHeadItem(item) ? 'led_5500k_8' : 'led_5500k_1';
}

function partitionHeadMainImageCoverSize(item = {}) {
  return isSmclPartitionHeadItem(item) ? [947, 593] : [474, 296];
}

function shouldUseExhibitorHeadTexture(materialName = '', meshName = '', item = {}, material = null) {
  const normalizedMeshName = normalizeMaterialName(meshName);
  if (isSmclPartitionHeadItem(item)) {
    const side = smclPartitionHeadSide(item);
    const targetMaterial = side === 'left' ? '_' : '_51';
    if (materialName !== targetMaterial) return false;
    if (materialMapMatchesFile(material, `${targetMaterial}.jpg`)) return true;
    return isLikelySmclInfoPanelMesh(normalizedMeshName);
  }
  return materialName === '_10'
    || materialName === '10'
    || materialName.endsWith('_10')
    || (normalizedMeshName.includes('mesh4') && normalizedMeshName.includes('group3'));
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
  const source = data?.currentSrc || data?.src || material?.map?.name || '';
  return safeDecodeUri(String(source || '').replaceAll('\\', '/').split('/').pop() || '');
}

function materialWithTexture(material, texture) {
  const next = material.clone?.() || material;
  next.map = texture;
  next.transparent = false;
  if (next.color?.set) next.color.set('#ffffff');
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

function createPartitionHeadInfoTexture(visualContext = {}, item = {}) {
  if (typeof document === 'undefined') return null;
  if (isSmclPartitionHeadItem(item)) return createSmclPartitionHeadInfoTexture(visualContext);

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
  texture.flipY = true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createSmclPartitionHeadInfoTexture(visualContext = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1181;
  canvas.height = 827;
  const ctx = canvas.getContext('2d');
  const company = String(visualContext?.company || 'NOM EXPOSANT').trim().toUpperCase();
  const standNumber = String(visualContext?.standNumber || 'A-14').replace(/^Stand\s+/i, '').trim().toUpperCase();
  const hall = String(visualContext?.hall || 'À DÉFINIR').replace(/^Hall\s+/i, '').trim().toUpperCase();

  ctx.fillStyle = '#ffd800';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  fitCanvasText(ctx, company, 238, 47, 670, 95);
  fitCanvasText(ctx, standNumber || 'A-14', 245, 202, 360, 130);
  fitCanvasText(ctx, `HALL ${hall || 'À DÉFINIR'}`, 245, 365, 420, 50);
  ctx.font = '900 42px Arial, sans-serif';
  ctx.fillText('salon', 285, 630);
  ctx.fillText('des maires', 285, 672);
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText('et des collectivités locales', 285, 720);

  return prepareDynamicTexture(new CanvasTexture(canvas));
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

function fitCanvasText(ctx, text, x, y, maxWidth, baseSize) {
  let size = baseSize;
  do {
    ctx.font = `900 ${size}px "Arial Narrow", Impact, Arial, sans-serif`;
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
  const fileName = safeDecodeUri(cleanUrl.replaceAll('\\', '/').split('/').pop() || '');
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

  if (relativeTexturePath && isSafeRelativeTexturePath(relativeTexturePath) && canUseRelativeTextureFallback(relativeTexturePath, storagePaths)) {
    return `${baseUrl}${encodeTexturePath(relativeTexturePath)}`;
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
    const texture = texturePaths.find((entry) => textureReferenceMatches(value, entry.fileName));
    if (!texture) {
      logTextureDiagnostic('MTL texture line kept for URL resolver fallback', {
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
    .find((path) => textureReferenceMatches(fileName, String(path).replaceAll('\\', '/').split('/').pop() || ''));
}

function textureReferenceMatches(reference = '', candidateFileName = '') {
  const normalizedReference = normalizeTextureName(reference);
  const normalizedCandidate = normalizeTextureName(candidateFileName);
  if (!normalizedReference || !normalizedCandidate) return false;
  if (normalizedReference.includes(normalizedCandidate)) return true;

  const referenceStem = normalizedReference.replace(/\.[a-z0-9]+$/i, '');
  const candidateStem = normalizedCandidate.replace(/\.[a-z0-9]+$/i, '');
  if (!isMeaningfulTextureStem(referenceStem) || !isMeaningfulTextureStem(candidateStem)) return false;
  return Boolean(referenceStem.includes(candidateStem) || candidateStem.includes(referenceStem));
}

function normalizeTextureName(value = '') {
  const fileName = safeDecodeUri(String(value || '').replaceAll('\\', '/').split('/').pop() || '');
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-');
}

function isMeaningfulTextureStem(stem = '') {
  return (String(stem).match(/[a-z0-9]/g) || []).length >= 3;
}

function canUseRelativeTextureFallback(relativePath = '', storagePaths = []) {
  if (!storagePaths.length) return true;
  const requestedFolder = normalizeStorageLookup(String(relativePath).replaceAll('\\', '/').split('/').slice(0, -1).join('/'));
  if (!requestedFolder) return true;
  return storagePaths.some((path) => {
    const parts = String(path || '').replaceAll('\\', '/').split('/').filter(Boolean);
    const relativeParts = parts.slice(1);
    const folder = normalizeStorageLookup(relativeParts.slice(0, -1).join('/'));
    return folder === requestedFolder;
  });
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
      onPointerOver={(event) => { event.stopPropagation(); onHover(true); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(false); }}
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
