import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useLoader } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Text } from '@react-three/drei';
import { Box3, DoubleSide, LoadingManager, MeshStandardMaterial, Plane, Vector3 } from 'three';
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
  Maximize2,
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
import { deleteObjectBankItem, deleteStandPreset, ensureSalonOffer, getSceneByToken, listClients, listObjectBank, listSalons, listScenes, requestSceneAccessCode, saveMondayBoardForPack, saveObjectBankItem, saveSalonOfferBaseItems, saveScene, saveStandPresetConfig, sceneShareUrl, syncMondayScenes, uploadObjectAssetFolder, uploadObjectAssetThumbnail, verifySceneAccessCode } from './data/sceneStore.js';
import { exportTechnicalPng } from './technicalExport.js';
import './styles.css';

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const wallSwitchZone = 0.18;
const fixedWallHeight = 2.5;
const wallThickness = 0.06;
const screenDepth = 0.06;
const wallItemSnap = 0.25;
const carpetFootprintSizeMeters = 1;
const carpetFootprintOverflow = 0.2;
const collisionPadding = 0.04;
const collisionPlacementStep = 0.25;
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
const placementRuleOptions = [
  { id: 'free', label: 'Libre', description: 'L’utilisateur peut poser et déplacer ce groupe normalement.' },
  { id: 'back-left', label: 'Coin fond gauche', description: 'Le groupe se colle automatiquement au mur du fond, côté gauche.' },
  { id: 'back-right', label: 'Coin fond droit', description: 'Le groupe se colle automatiquement au mur du fond, côté droit.' },
  { id: 'back-center', label: 'Centre du mur du fond', description: 'Le groupe reste centré contre le mur du fond.' },
];

function makeItem(type, width, depth, layout, catalogEntry = null) {
  const entry = catalogEntry || catalog.find((item) => item.type === type);
  const base = {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type,
    label: entry?.label,
    rotation: 0,
    collisionEnabled: entry?.dimensions?.collisionEnabled !== false,
  };

  if (entry?.isGroup || entry?.children?.length) {
    const item = {
      ...base,
      isGroup: true,
      groupSize: entry.groupSize || [1.2, 1, 1.2],
      children: resolveGroupChildren(entry.children || []),
      placementRule: normalizePlacementRule(entry.placementRule),
      lockedPlacement: isLockedPlacementRule(entry.placementRule),
      x: 0,
      z: Math.min(depth / 2 - 0.9, 0.7),
      y: 0,
    };
    return applyPlacementRule(item, width, depth, layout);
  }

  if (isCatalogWallEntry(entry, type)) {
    const side = layout === 'right' ? 'right' : layout === 'left' ? 'left' : 'back';
    const size = entry?.modelSize || entry?.dimensions?.size || [];
    return {
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
      y: isWallItemType(type) ? (type === 'poster' ? 1.45 : 1.65) : Number(entry?.dimensions?.wallY ?? 0),
      posterHeight: entry?.posterHeight,
      wallDepth: isWallItemType(type) ? undefined : Number(size?.[2] || 0.08),
    };
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
    y: 0,
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
    { id: 'screen-1', type: 'screen', x: 0, z: -1.5, y: 1.65, wall: 'back', rotation: 0 },
  ]).map((item) => constrainItem(item, initialWidth, initialDepth, initialLayout)));
  const initialReadOnly = initialScene.client_status === 'configured' && !isAdminViewer;
  const [selectedId, setSelectedId] = useState(initialReadOnly ? null : 'table-1');
  const [draggingId, setDraggingId] = useState(null);
  const [language, setLanguage] = useState('fr');
  const [headerPanel, setHeaderPanel] = useState(null);
  const [activeStep, setActiveStep] = useState(initialReadOnly ? 4 : 1);
  const [openOptions, setOpenOptions] = useState({ moquette: false, empreinte: false, coton: false, reserve: false, tete: false, comptoir: false });
  const [selectedCarpetId, setSelectedCarpetId] = useState(initialOptions.carpetColorId || '1893');
  const [selectedWallFabricId, setSelectedWallFabricId] = useState(initialOptions.wallFabricColorId || '303');
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const [saveState, setSaveState] = useState(initialScene.client_status || 'not_started');
  const [confirmState, setConfirmState] = useState({ loading: false, message: '', error: '' });
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
  const selectedWallFabricColor = wallFabricColors.find((color) => color.id === selectedWallFabricId) || wallFabricColors[0];
  const salonLabel = initialScene.salon || clientInfo.event || 'SMCL 2026';
  const standLabel = initialScene.project_name || clientInfo.project || 'Stand A-14';
  const clientLabel = clientInfo.client || contactDetails.company || 'Aerosys Industries';
  const faceLabel = layout === 'u' ? '3 faces ouvertes' : layout === 'back' ? '1 face ouverte' : '2 faces ouvertes';
  const selectedLanguage = languages.find((entry) => entry.id === language) || languages[0];
  const readOnly = saveState === 'configured' && !isAdminViewer;

  useEffect(() => {
    setItems((current) => current.map((item) => constrainItem(item, width, depth, layout)));
  }, [width, depth, layout]);

  useEffect(() => {
    if (readOnly) {
      setDraggingId(null);
      setSelectedId(null);
      setRotationPanelOpen(false);
    }
  }, [readOnly]);

  const availableCatalog = useMemo(() => {
    const dynamicEntries = objectBank
      .filter((asset) => asset.is_active)
      .filter((asset) => assetMatchesSalon(asset, salonLabel))
      .map(assetToCatalogEntry);
    const entries = [...dynamicEntries, ...nativeCatalogEntries()];
    return entries.filter((entry, index, all) => all.findIndex((item) => item.type === entry.type) === index);
  }, [objectBank, salonLabel]);
  const hydratedItems = useMemo(() => (
    objectBankLoaded ? items.map((item) => hydrateSceneItemFromCatalog(item, availableCatalog)) : items
  ), [items, availableCatalog, objectBankLoaded]);
  const selected = hydratedItems.find((item) => item.id === selectedId);

  useEffect(() => {
    if (!objectBank.length) return;
    setItems((current) => current.map((item) => hydrateSceneItemFromCatalog(item, availableCatalog)));
  }, [objectBank, availableCatalog]);

  const scenePricing = useMemo(() => calculateScenePricing({
    area,
    catalog: availableCatalog,
    items: hydratedItems,
    salonLabel,
    scene: initialScene,
  }), [area, availableCatalog, hydratedItems, salonLabel, initialScene]);
  const estimatedTotal = scenePricing.total;

  const currentScenePayload = (status, clientStatus) => {
    const options = {
      carpetColorId: selectedCarpetColor.id,
      carpetColorName: selectedCarpetColor.name,
      carpetColorHex: selectedCarpetColor.hex,
      wallFabricColorId: selectedWallFabricColor.id,
      wallFabricColorName: selectedWallFabricColor.name,
      wallFabricColorHex: selectedWallFabricColor.hex,
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
      items: hydratedItems,
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
  }, [width, depth, height, layout, hydratedItems, clientInfo, selectedCarpetColor, selectedWallFabricColor, saveState, readOnly]);

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
    setItems((current) => updateSceneItemWithCollision(current, id, patch, width, depth, layout));
  };

  const moveDraggedItem = (point) => {
    if (readOnly || !draggingId) return;
    const dragged = hydratedItems.find((item) => item.id === draggingId);
    if (!dragged) return;

    if (isWallItem(dragged)) {
      updateItem(draggingId, wallDragPatch(point, dragged, hydratedItems, width, depth, layout));
      return;
    }

    updateItem(draggingId, { x: point.x, z: point.z });
  };

  const addItem = (entry) => {
    if (readOnly) return;
    const item = makeItem(entry.type, width, depth, layout, entry);
    setItems((current) => {
      const placed = placeItemInFreeSpot(item, current, width, depth, layout);
      if (!placed) return current;
      return [...current, placed];
    });
    setSelectedId(item.id);
  };

  const removeOptionalItem = (type) => {
    if (readOnly) return;
    setItems((current) => {
      const index = [...current].reverse().findIndex((item) => item.type === type && !isIncludedSceneItem(item));
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
    setItems((current) => current.map((item) => constrainItem(item, width, depth, nextLayout)));
  };

  const deleteSelectedItem = () => {
    if (readOnly || !selected) return;
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
          className={draggingId ? 'dragging-canvas' : ''}
          shadows
          onPointerUp={() => {
            if (!readOnly) setDraggingId(null);
          }}
          onPointerLeave={() => {
            if (!readOnly) setDraggingId(null);
          }}
        >
          <color attach="background" args={['#eef0f4']} />
          <fog attach="fog" args={['#eef0f4', 9, 18]} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[3, 7, 4]} intensity={1.65} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center>Chargement</Html>}>
          <StandScene
            width={width}
            depth={depth}
            height={height}
            layout={layout}
            items={hydratedItems}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              interactive={!readOnly}
              onDragMove={moveDraggedItem}
              viewAngle={viewAngle}
              carpetColor={selectedCarpetColor.hex}
              wallColor={selectedWallFabricColor.hex}
            />
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

        <div className={`view-toolbar ${selected && !readOnly ? 'selection-mode' : ''}`} aria-label={selected ? 'Actions objet selectionne' : 'Outils de vue'}>
          {selected && !readOnly ? (
            <>
              <button type="button" disabled={itemPlacementLocked(selected)} onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
              <button type="button" onClick={deleteSelectedItem} title="Supprimer"><Trash2 size={16} /></button>
              {itemPlacementLocked(selected) && <span className="toolbar-lock-note">Placement verrouillé</span>}
              {rotationPanelOpen && !isWallItem(selected) && !itemPlacementLocked(selected) && (
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
            </>
          ) : (
            <>
              <button type="button"><Maximize2 size={16} /></button>
              <button type="button"><Minus size={16} /></button>
              <button type="button"><RotateCcw size={16} /></button>
              <button type="button"><Ruler size={16} /></button>
            </>
          )}
        </div>
      </section>

      {activeStep > 1 && (
      <aside className="config-panel">
        {activeStep === 3 ? (
          <FurnitureStepPanel
            items={hydratedItems}
            catalog={availableCatalog}
            pricing={scenePricing}
            salonLabel={salonLabel}
            readOnly={readOnly}
            onAdd={addItem}
            onRemove={removeOptionalItem}
          />
        ) : activeStep === 4 ? (
          <ValidationStepPanel
            area={area}
            layout={layout}
            standLabel={initialScene.project_name || 'Stand A-14'}
            carpetColor={selectedCarpetColor}
            wallFabricColor={selectedWallFabricColor}
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
            selectedWallFabricColor={selectedWallFabricColor}
            readOnly={readOnly}
            onCarpetColor={(colorId) => !readOnly && setSelectedCarpetId(colorId)}
            onWallColor={(colorId) => !readOnly && setSelectedWallFabricId(colorId)}
            onExport={() => exportTechnicalPng({ width, depth, layout, items: hydratedItems, catalog: availableCatalog })}
          />
        )}
      </aside>
      )}

      {activeStep > 1 && !readOnly && (
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

function OptionsStepPanel({
  activeStep,
  area,
  layout,
  standLabel,
  openOptions,
  toggleOption,
  selectedCarpetColor,
  selectedWallFabricColor,
  readOnly = false,
  onCarpetColor,
  onWallColor,
  onExport,
}) {
  return (
    <>
      <PanelHead title="Options de configuration" step={activeStep} />
      <StandSummary area={area} layout={layout} standLabel={standLabel} />
      <RulesSummary />

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
        <CarpetFootprintCard layout={layout} />
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
      <OptionAccordion title="Reserve" icon={<Layers size={16} />} open={openOptions.reserve} onToggle={() => toggleOption('reserve')} />
      <OptionAccordion title="Tete de cloison" icon={<Ruler size={16} />} open={openOptions.tete} onToggle={() => toggleOption('tete')} />
      <OptionAccordion title="Comptoir" icon={<Box size={16} />} open={openOptions.comptoir} onToggle={() => toggleOption('comptoir')} />

      <button className="wide export" onClick={onExport}>
        <FileImage size={16} /> Generer PNG technique
      </button>
    </>
  );
}

function FurnitureStepPanel({ items, catalog, pricing, salonLabel, readOnly = false, onAdd, onRemove }) {
  const includedItems = pricing?.baseItemsConfigured
    ? pricing.baseUsage.map((item) => ({ key: item.type, label: item.label, count: item.used, quota: item.quantity }))
    : sceneItemSummary(items.filter((item) => isIncludedSceneItem(item) && isFurniturePanelType(item)));
  const furnitureEntries = catalog.filter((entry) => furniturePanelCategory(entry) === 'furniture');
  const multimediaEntries = catalog.filter((entry) => furniturePanelCategory(entry) === 'multimedia');
  const billableCounts = pricing?.billableCounts || new Map();
  const displayedIncludedItems = pricing?.baseItemsConfigured ? includedItems : (includedItems.length ? includedItems : defaultIncludedFurniture());

  return (
    <>
      <PanelHead title="Mobilier & Multimedia" step={3} />
      <section className="furniture-panel-section">
        <h2>Mobilier standard</h2>
        <p>Inclus dans votre forfait</p>
        <div className="included-furniture-list">
          {displayedIncludedItems.length ? (
            displayedIncludedItems.map((item) => (
              <div key={item.key} className="included-furniture-card">
                <span><Check size={13} /></span>
                <strong>{item.quota ? basePackUsageText(item) : `${item.label}${item.count > 1 ? ` × ${item.count}` : ''}`}</strong>
                <em>Inclus</em>
              </div>
            ))
          ) : (
            <div className="included-furniture-empty">Aucun mobilier inclus dans ce pack.</div>
          )}
        </div>
      </section>

      <FurnitureCatalogSection
        title="Mobilier additionnel"
        entries={furnitureEntries}
        counts={billableCounts}
        salonLabel={salonLabel}
        readOnly={readOnly}
        onAdd={onAdd}
        onRemove={onRemove}
      />
      <FurnitureCatalogSection
        title="Multimedia"
        entries={multimediaEntries}
        counts={billableCounts}
        salonLabel={salonLabel}
        readOnly={readOnly}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </>
  );
}

function ValidationStepPanel({
  area,
  layout,
  standLabel,
  carpetColor,
  wallFabricColor,
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
        <div className="validation-option-row"><span>Coton cloison</span><strong>{wallFabricColor.name} ({wallFabricColor.code})</strong></div>
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

function RulesSummary() {
  return (
    <div className="rules-card">
      <strong>Regles SMCL appliquees automatiquement</strong>
      <span>✓ Reserve 2m2 incluse</span>
      <span>✓ 2 tetes de cloison</span>
      <span>✓ 9 spots LED (1/3m2)</span>
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

function CarpetFootprintCard({ layout }) {
  const sideOverflow = layout === 'left'
    ? 'Placée en coin avant droit : 200 mm sortent à droite'
    : layout === 'right'
      ? 'Placée en coin avant gauche : 200 mm sortent à gauche'
      : 'Placée devant le stand, sans débord latéral';

  return (
    <div className="carpet-footprint-card">
      <header>
        <strong>Dalles moquette 1000 × 1000 mm</strong>
        <span>Inclus</span>
      </header>
      <ul>
        <li>Dalle 1000 × 1000 mm positionnée à l’extrémité avant</li>
        <li>200 mm sortent dans l’allée devant le stand</li>
        <li>{sideOverflow}</li>
        <li>Même niveau que le sol : les objets peuvent être posés dessus</li>
      </ul>
      <small>Les couleurs de cette empreinte seront ajoutées dès réception des références.</small>
    </div>
  );
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
      .map(assetToCatalogEntry);
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
  const initialScene = presetToEditableScene(preset);
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
  const selected = items.find((item) => item.id === selectedId);

  useEffect(() => {
    setItems((current) => current.map((item) => constrainItem(item, width, depth, layout)));
  }, [width, depth, layout]);

  const availableCatalog = useMemo(() => {
    const dynamicEntries = (assets || [])
      .filter((asset) => asset.is_active)
      .filter((asset) => assetMatchesSalon(asset, salon.name))
      .map(assetToCatalogEntry);
    const entries = [...dynamicEntries, ...nativeCatalogEntries()];
    return entries.filter((entry, index, all) => all.findIndex((item) => item.type === entry.type) === index);
  }, [assets, salon.name]);

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
    onSave({
      dimensions: { width, depth, height: fixedWallHeight },
      layout,
      items,
      options: { presetMode: true, includedPack: offer?.name, salon: salon.name },
    });
  };

  return (
    <div className="preset-editor-grid">
      <section className="preset-3d-stage">
        <Canvas
          camera={{ position: [4.5, 4.2, 5.7], fov: 48 }}
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
              onDragMove={moveDraggedItem}
              viewAngle={35}
              carpetColor="#bebebe"
              wallColor="#f8f7f3"
            />
            <ContactShadows opacity={0.22} scale={12} blur={2.4} far={5} position={[0, -0.01, 0]} />
          </Suspense>
          <OrbitControls makeDefault target={[0, 0.7, 0]} minPolarAngle={Math.PI / 5.2} maxPolarAngle={Math.PI / 2.25} minDistance={4} maxDistance={11} enablePan enabled={!draggingId} />
        </Canvas>

        <div className={`view-toolbar preset-toolbar ${selected ? 'selection-mode' : ''}`}>
          {selected ? (
            <>
              <button type="button" disabled={itemPlacementLocked(selected)} onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
              <button type="button" onClick={() => { setItems((current) => current.filter((item) => item.id !== selected.id)); setSelectedId(null); }} title="Supprimer"><Trash2 size={16} /></button>
              {itemPlacementLocked(selected) && <span className="toolbar-lock-note">Placement verrouillé</span>}
              {rotationPanelOpen && !isWallItem(selected) && !itemPlacementLocked(selected) && (
                <label className="toolbar-rotation-slider">
                  <span>{selected.rotation || 0}°</span>
                  <input type="range" min="-180" max="180" step="5" value={selected.rotation || 0} onChange={(event) => updateItem(selected.id, { rotation: Number(event.target.value) })} />
                </label>
              )}
            </>
          ) : (
            <span>Selectionne un objet pour le déplacer, le tourner ou le supprimer.</span>
          )}
        </div>
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
        <h4>Objets inclus</h4>
        <p className="preset-included-help">Chaque objet sauvegardé ici est inclus dans la formule. Le client ne paiera que les quantités ajoutées au-delà.</p>
        <div className="preset-catalog">
          {availableCatalog.map((entry) => {
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

function presetToEditableScene(preset) {
  const items = (preset.stand_preset_items || []).map((item) => normalizePresetItem(item));
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

function normalizePresetItem(item) {
  const config = item.config || {};
  const catalogItem = catalog.find((entry) => entry.type === item.type);
  const isGroup = Boolean(config.isGroup || catalogItem?.isGroup);
  return {
    ...config,
    id: item.item_uid || config.id || `${item.type}-${item.id}`,
    type: item.type,
    label: item.label || config.label || catalogItem?.label || item.type,
    isGroup,
    groupSize: config.groupSize || catalogItem?.groupSize,
    children: isGroup ? resolveGroupChildren(config.children || catalogItem?.children || []) : config.children,
    placementRule: normalizePlacementRule(config.placementRule || catalogItem?.placementRule),
    lockedPlacement: config.lockedPlacement ?? isLockedPlacementRule(config.placementRule || catalogItem?.placementRule),
    x: Number(item.x ?? config.x ?? 0),
    y: Number(item.y ?? config.y ?? 0),
    z: Number(item.z ?? config.z ?? 0),
    rotation: Number(item.rotation ?? config.rotation ?? 0),
    wall: item.wall || config.wall,
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
  const categories = ['Tout', 'Groupes', 'Sol & Cloisons', 'Mobilier', 'Signalétique', 'Multimédia', 'Enseignes', 'Électricité'];
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
          <span>Ajouter un dossier OBJ complet, ou un dossier contenant un .GLB</span>
          <strong>{uploadState?.loading ? 'Import en cours...' : 'Parcourir un dossier'}</strong>
          <small>Le dossier doit contenir l’OBJ, son .MTL et les textures. Les chemins relatifs sont conservés.</small>
          <input
            type="file"
            accept=".obj,.glb,.mtl,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tga,.tif,.tiff"
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
        <button className="asset-group-create-button" type="button" onClick={() => setGroupCreatorOpen(true)}>
          <Layers size={18} />
          Creer un groupe d'objets
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
    </section>
  );
}

function AssetPreview({ asset }) {
  const url = asset.thumbnail_url;
  if (url) return <img className="asset-thumb" src={url} alt="" />;
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
  const sourceAssets = groupSourceAssets(assets);
  const fallbackType = sourceAssets[0]?.type || '';
  const activeGroupRowUid = selectedGroupRowUid || groupRows[0]?.uid || null;
  const draftPlacementRuleId = normalizePlacementRule(draft.dimensions?.placementRule)?.id || 'free';
  const draftMountType = assetPlacementMode(draft);
  const draftCollisionEnabled = draft.dimensions?.collisionEnabled !== false;

  useEffect(() => {
    setDraft(asset);
    setThumbnailUploading(false);
    setThumbnailError('');
    setGroupRows(assetToGroupRows(asset));
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

        <dl className="asset-meta-card">
          <div><dt>Nom</dt><dd>{draft.label}</dd></div>
          <div><dt>Catégorie</dt><dd>{assetCategoryLabel(draft)}</dd></div>
          <div><dt>Format</dt><dd>{assetFormat(draft)}{assetFormat(draft) === 'OBJ' ? ' (converti depuis OBJ)' : ''}</dd></div>
          <div><dt>Taille</dt><dd>{assetSizeLabel(draft)}</dd></div>
          <div><dt>Dimensions</dt><dd>{assetDimensionsLabel(draft)}</dd></div>
          <div><dt>Ajouté le</dt><dd>{formatDate(draft.created_at)}</dd></div>
          <div><dt>Ajouté par</dt><dd>{draft.dimensions?.addedBy || 'Stand-ING'}</dd></div>
        </dl>

        {!isGroupAsset && (
          <section className="asset-behavior-settings">
            <h3>Comportement dans la scène</h3>
            <label>
              <span>Placement</span>
              <select value={draftMountType} onChange={(event) => updateAssetBehavior({ mountType: event.target.value })}>
                <option value="floor">Objet au sol</option>
                <option value="wall">Objet rattaché à un mur</option>
              </select>
            </label>
            <label className="asset-toggle-row">
              <input
                type="checkbox"
                checked={draftCollisionEnabled}
                onChange={(event) => updateAssetBehavior({ collisionEnabled: event.target.checked })}
              />
              <span>
                <strong>Collision active</strong>
                <small>Désactive-la pour permettre de poser ou déplacer des objets au travers/en dessous.</small>
              </span>
            </label>
          </section>
        )}

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
                {active && (
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
              </div>
            );
          })}
        </section>

        {isGroupAsset && (
          <>
            <section className="asset-group-placement">
              <h3>Règle de placement</h3>
              <label>
                <span>Position obligatoire</span>
                <select value={draftPlacementRuleId} onChange={(event) => updatePlacementRule(event.target.value)}>
                  {placementRuleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <small>{placementRuleLabel(draftPlacementRuleId, true)}</small>
            </section>

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

        <small className="asset-price-note">Les prix et références peuvent être différents pour chaque salon actif.</small>

        <footer>
          <button type="button" className="asset-delete" onClick={onDelete}>Supprimer définitivement</button>
          <button type="button" className="asset-save" onClick={saveDraft}>Enregistrer les modifications</button>
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
  if (asset.dimensions?.isGroup) return 'Groupes';
  if (asset.dimensions?.category) return asset.dimensions.category;
  if (asset.type?.includes('screen')) return 'Multimédia';
  if (asset.type?.includes('poster')) return 'Signalétique';
  if (asset.type?.includes('cloison') || asset.type?.includes('porte')) return 'Sol & Cloisons';
  if (asset.type?.includes('enseigne')) return 'Enseignes';
  return 'Mobilier';
}

function assetFormat(asset) {
  if (asset.dimensions?.isGroup) return 'Groupe';
  const url = asset.model_url || '';
  const ext = url.split('.').pop()?.toUpperCase();
  if (ext === 'OBJ' || ext === 'GLB') return ext;
  return asset.model_url ? '3D' : 'Natif';
}

function assetSizeLabel(asset) {
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
  const dynamicAssets = assets.filter((asset) => asset.is_active && !asset.dimensions?.isGroup && !isWallItemType(asset.type));
  const all = [...baseAssets, ...dynamicAssets];
  return all.filter((asset, index) => all.findIndex((candidate) => candidate.type === asset.type) === index);
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

function assetToCatalogEntry(asset) {
  if (asset.dimensions?.isGroup) {
    return {
      type: asset.type,
      label: asset.label,
      icon: Layers,
      color: asset.dimensions?.color || '#dfe8ec',
      isGroup: true,
      groupSize: asset.dimensions?.groupSize || computeGroupSize(asset.dimensions?.children || []),
      children: asset.dimensions?.children || [],
      placementRule: normalizePlacementRule(asset.dimensions?.placementRule),
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
  const category = furniturePanelCategory(entry);
  return category === 'furniture' || category === 'multimedia';
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
    const unitPrice = assetUnitPrice(entry, salonLabel);
    const lineTotal = unitPrice * billableCount;
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
  const dimensions = {
    ...(entry.dimensions || {}),
    ...(item.dimensions || {}),
  };
  const materialUrl = item.materialUrl || item.dimensions?.materialUrl || entry.materialUrl || entry.dimensions?.materialUrl;
  const hydrated = {
    ...item,
    label: item.label || entry.label,
    isGroup,
    groupSize: item.groupSize || entry.groupSize,
    placementRule: item.placementRule || entry.placementRule,
    lockedPlacement: item.lockedPlacement ?? Boolean(item.placementRule || entry.placementRule?.locked),
    modelUrl: item.modelUrl || entry.modelUrl,
    modelSize: item.modelSize || entry.modelSize,
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
  if (category.includes('multimedia')) return 'multimedia';
  if (category.includes('mobilier')) return 'furniture';
  if (category.includes('sol') || category.includes('cloison')) return 'hidden';
  if (text.includes('cloison') || text.includes('porte poussant')) return 'hidden';
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

function isLockedPlacementRule(rule) {
  return Boolean(normalizePlacementRule(rule)?.locked);
}

function itemPlacementLocked(item) {
  return Boolean(item?.lockedPlacement || isLockedPlacementRule(item?.placementRule));
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

function assetPlacementMode(assetOrEntry = {}) {
  const mountType = assetOrEntry?.dimensions?.mountType || assetOrEntry?.mountType;
  return mountType === 'wall' ? 'wall' : 'floor';
}

function isCatalogWallEntry(entry, type) {
  return isWallItemType(type) || assetPlacementMode(entry) === 'wall' || Boolean(entry?.isWallItem);
}

function isWallItem(item) {
  return isWallItemType(item?.type) || Boolean(item?.wall && item?.isWallItem);
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

function placementRegions(width, depth, layout, itemBounds) {
  return [standFloorBounds(width, depth, layout), carpetFootprintBounds(width, depth, layout)]
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

function screenAxisRange(wall, width, depth, margin = 0.55) {
  const length = wall === 'back' ? width : depth;
  return {
    min: -length / 2 + margin,
    max: length / 2 - margin,
  };
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
  const objectWall = objectWallFromDrag(point, items, dragged.id);
  if (objectWall) {
    return {
      wall: objectWall.surface.id,
      x: objectWall.axis,
      wallSide: objectWall.side,
      wallSurface: serializeObjectWallSurface(objectWall.surface),
    };
  }

  const wall = wallFromDrag(point, dragged.wall, width, depth, layout);
  return {
    wall,
    x: wall === 'back' ? point.x : point.z,
    wallSide: null,
    wallSurface: null,
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
  return (group.children || [])
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

  if (rule.id === 'back-right') {
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

  return {
    ...base,
    x: Number((-width / 2 + clearance - bounds.minX).toFixed(2)),
    z: Number((-depth / 2 + clearance - bounds.minZ).toFixed(2)),
  };
}

function constrainItem(item, width, depth, layout) {
  if (isWallItem(item)) {
    if (isObjectWallId(item.wall)) {
      const surface = item.wallSurface;
      if (surface) {
        const halfLength = surface.length / 2;
        const itemHalfWidth = wallItemMetrics(item, [], width, depth).width / 2;
        const margin = Math.min(itemHalfWidth, Math.max(0, halfLength - 0.02));
        const min = surface.centerAxis - halfLength + margin;
        const max = surface.centerAxis + halfLength - margin;
        return { ...item, x: clamp(snapWallAxis(item.x), min, max) };
      }
    }

    const validWalls = availableWalls(layout).map((wall) => wall.id);
    const wall = validWalls.includes(item.wall) ? item.wall : 'back';
    const margin = item.type === 'poster' ? 0.25 : 0.55;
    const range = screenAxisRange(wall, width, depth, margin);
    const axis = clamp(snapWallAxis(item.x), range.min, range.max);
    return { ...item, wall, x: axis, z: wall === 'back' ? -depth / 2 + wallThickness : axis };
  }

  const positionedItem = applyPlacementRule(item, width, depth, layout);
  const bounds = itemPlacementBounds(positionedItem);
  const placement = closestPlacementInRegions(positionedItem, placementRegions(width, depth, layout, bounds));

  return {
    ...positionedItem,
    x: placement.x,
    z: placement.z,
  };
}

function updateSceneItemWithCollision(items, id, patch, width, depth, layout) {
  const currentItem = items.find((item) => item.id === id);
  if (!currentItem) return items;

  const candidate = constrainItem({ ...currentItem, ...patch }, width, depth, layout);
  if (collidesWithScene(candidate, items, id, width, depth)) return items;
  return items.map((item) => (item.id === id ? candidate : item));
}

function placeItemInFreeSpot(item, items, width, depth, layout) {
  const firstCandidate = constrainItem(item, width, depth, layout);
  if (isWallItem(firstCandidate)) return placeWallItemInFreeSpot(firstCandidate, items, width, depth, layout);
  if (itemPlacementLocked(firstCandidate)) return collidesWithScene(firstCandidate, items, firstCandidate.id, width, depth) ? null : firstCandidate;
  if (!collidesWithScene(firstCandidate, items, firstCandidate.id, width, depth)) return firstCandidate;

  const bounds = itemPlacementBounds(firstCandidate);
  const regions = placementRegions(width, depth, layout, bounds);
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
    const candidate = constrainItem({ ...firstCandidate, x: position.x, z: position.z }, width, depth, layout);
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
    const margin = item.type === 'poster' ? 0.25 : 0.55;
    const range = screenAxisRange(wall, width, depth, margin);
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

function wallItemCollisionBox(item, items, width, depth) {
  if (!isWallItem(item) || !itemCollisionEnabled(item)) return null;
  const metrics = wallItemMetrics(item, items, width, depth);
  const axis = Number(item.x || 0);
  const y = Number(item.y || 1.5);
  return {
    wall: item.wall || 'back',
    minAxis: axis - metrics.width / 2 - collisionPadding,
    maxAxis: axis + metrics.width / 2 + collisionPadding,
    minY: y - metrics.height / 2 - collisionPadding,
    maxY: y + metrics.height / 2 + collisionPadding,
  };
}

function wallItemMetrics(item, items, width, depth) {
  if (item.type === 'poster') {
    return {
      width: posterAvailableWidth(item, items, width, depth),
      height: Number(item.posterHeight || 1.25),
    };
  }
  if (item.modelUrl) {
    const size = itemDefaultSize(item);
    return {
      width: Number(size[0] || 0.95),
      height: Number(size[1] || 0.58),
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
  const radians = ((Number(item.rotation || 0) * Math.PI) / 180);
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const rotatedHalfX = Math.abs(Math.cos(radians)) * halfWidth + Math.abs(Math.sin(radians)) * halfDepth;
  const rotatedHalfZ = Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfDepth;
  const centerX = Number(bounds.centerX || 0);
  const centerZ = Number(bounds.centerZ || 0);

  return {
    minX: centerX - rotatedHalfX,
    maxX: centerX + rotatedHalfX,
    minZ: centerZ - rotatedHalfZ,
    maxZ: centerZ + rotatedHalfZ,
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

  if (!item.isGroup || !item.children?.length) return centeredBounds(itemDefaultSize(item));

  if (item.groupSize?.length >= 3) {
    const childBounds = item.children?.length ? childrenBounds(item.children) : null;
    if (childBounds) return childBounds;
    return centeredBounds(item.groupSize);
  }

  return childrenBounds(item.children) || centeredBounds();
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
    const size = itemDefaultSize(child);
    const childSize = { width: size[0], depth: size[2], height: size[1] };
    const radians = ((Number(child.rotation || 0) * Math.PI) / 180);
    const halfX = Math.abs(Math.cos(radians)) * childSize.width / 2 + Math.abs(Math.sin(radians)) * childSize.depth / 2;
    const halfZ = Math.abs(Math.sin(radians)) * childSize.width / 2 + Math.abs(Math.cos(radians)) * childSize.depth / 2;
    return {
      minX: Math.min(acc.minX, Number(child.x || 0) - halfX),
      maxX: Math.max(acc.maxX, Number(child.x || 0) + halfX),
      minZ: Math.min(acc.minZ, Number(child.z || 0) - halfZ),
      maxZ: Math.max(acc.maxZ, Number(child.z || 0) + halfZ),
      height: Math.max(acc.height, childSize.height),
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
  const side = Number(item.wallSide || 1) >= 0 ? 1 : -1;
  const screenOffset = wallMountedNormalOffset(item);
  const axis = Number(item.x || surface.centerAxis || 0);
  const position = surface.orientation === 'x'
    ? [axis, item.y, Number(surface.normalAxis || 0) + side * screenOffset]
    : [Number(surface.normalAxis || 0) + side * screenOffset, item.y, axis];
  const rotation = surface.orientation === 'x'
    ? (side >= 0 ? 0 : Math.PI)
    : (side >= 0 ? Math.PI / 2 : -Math.PI / 2);
  return { position, rotation, surface };
}

function screenWorldPosition(item, width, depth, items = []) {
  const objectTransform = objectWallTransform(item, items);
  if (objectTransform) return objectTransform.position;
  const screenOffset = wallMountedNormalOffset(item);
  if (item.wall === 'left') return [-width / 2 + screenOffset, item.y, item.x];
  if (item.wall === 'right') return [width / 2 - screenOffset, item.y, item.x];
  return [item.x, item.y, -depth / 2 + screenOffset];
}

function wallMountedNormalOffset(item) {
  if (item?.type === 'poster') return wallThickness + 0.035 / 2;
  if (item?.type === 'screen') return wallThickness + screenDepth / 2;
  const depth = Number(item?.wallDepth || itemDefaultSize(item)?.[2] || 0.08);
  return wallThickness + Math.max(0.02, depth / 2);
}

function posterAvailableWidth(item, items, width, depth) {
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
  return Math.max(0.5, Number((segmentMax - segmentMin - 0.2).toFixed(2)));
}

function wallBlockers(currentItem, items, width, depth, wall) {
  return (items || [])
    .filter((item) => item.id !== currentItem.id)
    .flatMap((item) => {
      if (isWallItem(item)) return wallMountedBlocker(item, wall, width, depth);
      return floorWallBlocker(item, wall, width, depth);
    })
    .filter(Boolean);
}

function wallMountedBlocker(item, wall, width, depth) {
  if (!itemCollisionEnabled(item)) return null;
  if ((item.wall || 'back') !== wall) return null;
  const axis = Number(item.x || 0);
  const itemWidth = wallItemMetrics(item, [], width, depth).width;
  return { min: axis - itemWidth / 2 - 0.1, max: axis + itemWidth / 2 + 0.1 };
}

function floorWallBlocker(item, wall, width, depth) {
  const bounds = itemCollisionBox(item);
  if (!bounds) return null;
  const minX = bounds.minX;
  const maxX = bounds.maxX;
  const minZ = bounds.minZ;
  const maxZ = bounds.maxZ;
  const wallZone = 0.72;

  if (wall === 'back' && minZ <= -depth / 2 + wallZone) return { min: minX - 0.1, max: maxX + 0.1 };
  if (wall === 'left' && minX <= -width / 2 + wallZone) return { min: minZ - 0.1, max: maxZ + 0.1 };
  if (wall === 'right' && maxX >= width / 2 - wallZone) return { min: minZ - 0.1, max: maxZ + 0.1 };
  return null;
}

function StandScene({ width, depth, height, layout, items, selectedId, setSelectedId, draggingId, setDraggingId, onDragMove, viewAngle, carpetColor, wallColor, interactive = true }) {
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

  return (
    <group position={cameraPivot}>
      {interactive && <DragSurface width={width} depth={depth} layout={layout} sceneOffset={cameraPivot} draggingId={draggingId} onDragMove={onDragMove} />}
      <Floor width={width} depth={depth} layout={layout} carpetColor={carpetColor} />
      <Grid width={width} depth={depth} layout={layout} />
      <Walls width={width} depth={depth} height={height} layout={layout} wallColor={wallColor} />
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
          dragging={item.id === draggingId}
          onSelect={() => interactive && setSelectedId(item.id)}
          onDragStart={(event) => {
            event.stopPropagation();
            if (!interactive) return;
            setSelectedId(item.id);
            if (itemPlacementLocked(item)) return;
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
        />
      ))}
    </group>
  );
}

function Floor({ width, depth, layout, carpetColor }) {
  const footprint = rectSize(carpetFootprintBounds(width, depth, layout));
  return (
    <group>
      <mesh receiveShadow position={[0, -0.035, 0]}>
        <boxGeometry args={[width, 0.07, depth]} />
        <meshStandardMaterial color={carpetColor || '#bebebe'} roughness={0.78} />
      </mesh>
      <mesh receiveShadow position={[footprint.centerX, 0.003, footprint.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[footprint.width, footprint.depth]} />
        <meshStandardMaterial color={carpetColor || '#bebebe'} roughness={0.78} />
      </mesh>
      <FootprintOutline bounds={footprint} />
    </group>
  );
}

function DragSurface({ width, depth, layout, sceneOffset, draggingId, onDragMove }) {
  const footprint = rectSize(carpetFootprintBounds(width, depth, layout));
  const dragPlane = (key, position, size) => (
    <mesh
      key={key}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(event) => {
        if (!draggingId) return;
        event.stopPropagation();
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
      {dragPlane('footprint', [footprint.centerX, 0.016, footprint.centerZ], [footprint.width, footprint.depth])}
    </group>
  );
}

function Grid({ width, depth }) {
  const lines = [];
  for (let x = -width / 2; x <= width / 2 + 0.01; x += 1) lines.push({ key: `x-${x}`, position: [x, 0.006, 0], scale: [0.01, 0.01, depth] });
  for (let z = -depth / 2; z <= depth / 2 + 0.01; z += 1) lines.push({ key: `z-${z}`, position: [0, 0.007, z], scale: [width, 0.01, 0.01] });
  return (
    <group>
      {lines.map((line) => (
        <mesh key={line.key} position={line.position}>
          <boxGeometry args={line.scale} />
          <meshStandardMaterial color="#d8d0bd" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function FootprintOutline({ bounds }) {
  const y = 0.01;
  const thickness = 0.018;
  const color = '#9b927f';
  return (
    <group>
      <mesh position={[bounds.centerX, y, bounds.minZ]}><boxGeometry args={[bounds.width, thickness, thickness]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
      <mesh position={[bounds.centerX, y, bounds.maxZ]}><boxGeometry args={[bounds.width, thickness, thickness]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
      <mesh position={[bounds.minX, y, bounds.centerZ]}><boxGeometry args={[thickness, thickness, bounds.depth]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
      <mesh position={[bounds.maxX, y, bounds.centerZ]}><boxGeometry args={[thickness, thickness, bounds.depth]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
    </group>
  );
}

function Walls({ width, depth, height, layout, wallColor }) {
  const sideDepth = Math.max(0.01, depth - wallThickness);
  const sideZ = -depth / 2 + wallThickness + sideDepth / 2;
  return (
    <group>
      <Wall position={[0, height / 2, -depth / 2 + wallThickness / 2]} size={[width, height, wallThickness]} color={wallColor} />
      {(layout === 'left' || layout === 'u') && <Wall position={[-width / 2 + wallThickness / 2, height / 2, sideZ]} size={[wallThickness, height, sideDepth]} color={wallColor} />}
      {(layout === 'right' || layout === 'u') && <Wall position={[width / 2 - wallThickness / 2, height / 2, sideZ]} size={[wallThickness, height, sideDepth]} color={wallColor} />}
    </group>
  );
}

function Wall({ position, size, color }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.62} />
    </mesh>
  );
}

function SceneItem({ item, items = [], selected, dragging, width, depth, onSelect, onDragStart, onDragEnd, onDragMove }) {
  const rotationY = (item.rotation * Math.PI) / 180;
  if (isWallItem(item)) return <WallMountedItem item={item} items={items} width={width} depth={depth} selected={selected} dragging={dragging} onSelect={onSelect} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} />;
  if (item.isGroup) return <GroupedSceneItem item={item} selected={selected} dragging={dragging} rotationY={rotationY} onSelect={onSelect} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} />;
  return (
    <group
      position={[item.x, 0, item.z]}
      rotation={[0, rotationY, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerMove={(event) => {
        if (dragging) onDragMove(event);
      }}
    >
      <SceneItemContent item={item} selected={selected} dragging={dragging} />
    </group>
  );
}

function GroupedSceneItem({ item, selected, dragging, rotationY, onSelect, onDragStart, onDragEnd, onDragMove }) {
  const groupBounds = itemGroupBounds(item);
  return (
    <group
      position={[item.x, 0, item.z]}
      rotation={[0, rotationY, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerMove={(event) => {
        if (dragging) onDragMove(event);
      }}
    >
      {item.children?.map((child) => (
        <group key={child.id} position={[child.x || 0, child.y || 0, child.z || 0]} rotation={[0, ((child.rotation || 0) * Math.PI) / 180, 0]}>
          <SceneItemContent item={child} selected={selected} dragging={dragging} />
        </group>
      ))}
      {selected && (
        <mesh position={[groupBounds.centerX, 0.02, groupBounds.centerZ]}>
          <boxGeometry args={[groupBounds.width, 0.025, groupBounds.depth]} />
          <meshBasicMaterial color="#ffcf5a" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function SceneItemContent({ item, selected, dragging }) {
  return (
    <>
      {item.type === 'chair' && <Chair selected={selected} dragging={dragging} />}
      {item.type === 'table' && <Table selected={selected} dragging={dragging} />}
      {item.type === 'counter' && <Counter selected={selected} dragging={dragging} />}
      {item.modelUrl && (
        <>
          <ObjHitbox size={itemDefaultSize(item)} />
          <Model3D item={item} selected={selected} dragging={dragging} />
        </>
      )}
    </>
  );
}

function activeColor(selected, dragging, base) {
  if (dragging) return '#f6a23a';
  return selected ? '#ffcf5a' : base;
}

function ObjHitbox({ size = [0.7, 0.7, 0.7] }) {
  const [x, y, z] = size;
  const thinVerticalPanel = Number(y || 0) >= 1.5 && Math.min(Number(x || 0), Number(z || 0)) <= 0.18;
  const minFootprint = thinVerticalPanel ? 0.08 : 0.18;
  return (
    <mesh position={[0, Math.max(y, 0.35) / 2, 0]}>
      <boxGeometry args={[Math.max(x, minFootprint), Math.max(y, 0.35), Math.max(z, minFootprint)]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Model3D({ item, selected, dragging }) {
  const materialUrl = modelMaterialUrl(item);
  if (item.modelUrl?.toLowerCase().split('?')[0].endsWith('.glb')) return <GlbModel item={item} />;
  if (materialUrl) return <ObjModelWithMaterials item={item} materialUrl={materialUrl} />;
  return <ObjModel item={item} selected={selected} dragging={dragging} />;
}

function GlbModel({ item }) {
  const gltf = useLoader(GLTFLoader, item.modelUrl);
  const model = useMemo(() => prepareLoadedModel(gltf.scene), [gltf]);
  return <primitive object={model} dispose={null} />;
}

function ObjModelWithMaterials({ item, materialUrl }) {
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
  const model = useMemo(() => prepareLoadedModel(obj), [obj]);

  return <primitive object={model} dispose={null} />;
}

function modelMaterialUrl(item) {
  return item?.materialUrl || item?.dimensions?.materialUrl || null;
}

function ObjModel({ item, selected, dragging }) {
  const obj = useLoader(OBJLoader, item.modelUrl);
  const model = useMemo(() => {
    const clone = obj.clone(true);
    const material = new MeshStandardMaterial({
      color: activeColor(selected, dragging, defaultModelColor(item)),
      roughness: defaultModelRoughness(item),
      metalness: defaultModelMetalness(item),
      side: DoubleSide,
    });

    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = material;
      }
    });

    return centerModel(clone);
  }, [obj, item.color, selected, dragging]);

  return <primitive object={model} dispose={null} />;
}

function prepareLoadedModel(source) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = cloneMeshMaterial(child.material);
    }
  });
  return centerModel(clone);
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
  const matchingPath = storagePaths.find((path) => normalizeStorageLookup(path).endsWith(`/${normalizedFileName}`));
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
    if (matchingRelativePath && rootPath) return textureUrlFromStoragePath(baseUrl, rootPath, matchingRelativePath);
    return `${baseUrl}${encodeTexturePath(relativeTexturePath)}`;
  }

  const modelFolder = modelSiblingFolder(item?.modelUrl || modelMaterialUrl(item) || '');
  const shouldTryModelFolder = /arche|jardiniere|jardinière/i.test(`${item?.type || ''} ${item?.label || ''} ${modelFolder}`);
  if (shouldTryModelFolder && modelFolder && !cleanUrl.includes(`/${modelFolder}/`)) {
    return `${baseUrl}${encodeURIComponent(modelFolder)}/${encodeURIComponent(fileName)}`;
  }

  // Fallback for old OBJ uploads where MTL files reference an obsolete folder name.
  return `${baseUrl}${encodeURIComponent(fileName)}`;
}

function rewriteRuntimeMtlReferences(text, item) {
  const rootPath = item?.dimensions?.storageRoot || item?.type || '';
  const storagePaths = Array.isArray(item?.dimensions?.storagePaths) ? item.dimensions.storagePaths : [];
  if (!text || !storagePaths.length || !rootPath) return text;

  const texturePaths = storagePaths
    .filter(isTextureResource)
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
    const normalizedValue = normalizeStorageLookup(value);
    const texture = texturePaths.find((entry) => normalizedValue.includes(normalizeStorageLookup(entry.fileName)));
    if (!texture) return line;
    return `${match[1]}${texture.relativePath}`;
  }).join('\n');
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
    const marker = `/${rootPath.replace(/^\/+|\/+$/g, '')}/`;
    const index = decodedUrl.indexOf(marker);
    if (index >= 0) return decodedUrl.slice(index + marker.length);
  }

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

function centerModel(model) {
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  return model;
}

function Chair({ selected, dragging }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.28, 0]}>
        <boxGeometry args={[0.52, 0.12, 0.5]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#c85f3f')} roughness={0.55} />
      </mesh>
      <mesh castShadow position={[0, 0.72, -0.22]}>
        <boxGeometry args={[0.52, 0.75, 0.1]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#bd5138')} roughness={0.55} />
      </mesh>
      {[-0.18, 0.18].map((x) => [-0.16, 0.16].map((z) => (
        <mesh key={`${x}-${z}`} castShadow position={[x, 0.12, z]}>
          <cylinderGeometry args={[0.025, 0.025, 0.25, 12]} />
          <meshStandardMaterial color="#3b3a33" />
        </mesh>
      )))}
    </group>
  );
}

function Table({ selected, dragging }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.48, 0.48, 0.08, 48]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#1d8f83')} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.055, 0.075, 0.58, 18]} />
        <meshStandardMaterial color="#35423c" />
      </mesh>
      <mesh castShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.05, 28]} />
        <meshStandardMaterial color="#35423c" />
      </mesh>
    </group>
  );
}

function Counter({ selected, dragging }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.48, 0]}>
        <boxGeometry args={[1.05, 0.9, 0.45]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#d5b767')} roughness={0.46} />
      </mesh>
      <mesh castShadow position={[0, 0.96, -0.08]}>
        <boxGeometry args={[1.15, 0.1, 0.5]} />
        <meshStandardMaterial color="#fff8db" roughness={0.42} />
      </mesh>
    </group>
  );
}

function WallMountedItem({ item, items, width, depth, selected, dragging, onSelect, onDragStart, onDragEnd, onDragMove }) {
  const objectTransform = objectWallTransform(item, items);
  const rotation = objectTransform?.rotation ?? (item.wall === 'left' ? Math.PI / 2 : item.wall === 'right' ? -Math.PI / 2 : 0);
  const offset = objectTransform?.position ?? screenWorldPosition(item, width, depth, items);
  const isPoster = item.type === 'poster';
  const isCustomModel = Boolean(item.modelUrl);
  const posterWidth = isPoster ? posterAvailableWidth(item, items, width, depth) : 0.95;
  const posterHeight = item.posterHeight || 1.25;
  return (
    <group
      position={offset}
      rotation={[0, rotation, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerMove={(event) => {
        if (dragging) onDragMove(event);
      }}
    >
      {isPoster ? (
        <>
          <mesh castShadow>
            <boxGeometry args={[posterWidth, posterHeight, 0.035]} />
            <meshStandardMaterial color={activeColor(selected, dragging, '#f7f1dc')} roughness={0.48} />
          </mesh>
          <mesh position={[0, 0, 0.026]}>
            <boxGeometry args={[Math.max(0.2, posterWidth - 0.12), Math.max(0.2, posterHeight - 0.12), 0.012]} />
            <meshStandardMaterial color="#ffffff" roughness={0.36} />
          </mesh>
          <Text position={[0, 0, 0.038]} fontSize={0.16} color="#1f4378" anchorX="center" anchorY="middle">AFFICHE</Text>
        </>
      ) : isCustomModel ? (
        <SceneItemContent item={item} selected={selected} dragging={dragging} />
      ) : (
        <>
          <mesh castShadow>
            <boxGeometry args={[0.95, 0.58, 0.06]} />
            <meshStandardMaterial color={activeColor(selected, dragging, '#182233')} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.035]}>
            <boxGeometry args={[0.82, 0.45, 0.015]} />
            <meshStandardMaterial color="#67d7ff" emissive="#1c6887" emissiveIntensity={0.55} />
          </mesh>
        </>
      )}
    </group>
  );
}

createRoot(document.getElementById('root')).render(<App />);
