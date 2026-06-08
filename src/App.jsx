import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useLoader } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Text } from '@react-three/drei';
import { Box3, MeshStandardMaterial, Plane, Vector3 } from 'three';
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
import { deleteStandPreset, ensureSalonOffer, getSceneByToken, listClients, listObjectBank, listSalons, listScenes, requestSceneAccessCode, saveMondayBoardForPack, saveObjectBankItem, saveScene, saveStandPresetConfig, sceneShareUrl, syncMondayScenes, uploadObjectAssetFolder, verifySceneAccessCode } from './data/sceneStore.js';
import { exportTechnicalPng } from './technicalExport.js';
import './styles.css';

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const wallSwitchZone = 0.18;
const fixedWallHeight = 2.5;
const wallThickness = 0.06;
const screenDepth = 0.06;
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

function makeItem(type, width, depth, layout, catalogEntry = null) {
  const entry = catalogEntry || catalog.find((item) => item.type === type);
  const base = {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type,
    label: entry?.label,
    rotation: 0,
  };

  if (entry?.isGroup || entry?.children?.length) {
    return {
      ...base,
      isGroup: true,
      groupSize: entry.groupSize || [1.2, 1, 1.2],
      children: resolveGroupChildren(entry.children || []),
      x: 0,
      z: Math.min(depth / 2 - 0.9, 0.7),
      y: 0,
    };
  }

  if (type === 'screen') {
    const side = layout === 'right' ? 'right' : layout === 'left' ? 'left' : 'back';
    return {
      ...base,
      wall: side,
      x: 0,
      z: side === 'back' ? -depth / 2 + wallThickness : 0,
      y: 1.65,
    };
  }

  return {
    ...base,
    modelUrl: entry?.modelUrl,
    modelSize: entry?.modelSize,
    materialUrl: entry?.materialUrl,
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

  useEffect(() => {
    if (isAdmin) return;
    if (!sceneToken) {
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
          if (mounted) setScene(loaded);
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
          const loaded = await getSceneByToken(sceneToken);
          setScene(loaded);
          setSceneAccessRequired(false);
        }}
      />
    );
  }
  if (loading || !scene) return <div className="loading-screen">Chargement de la scene...</div>;

  return <ConfiguratorApp initialScene={scene} />;
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
      setAdminUser(null);
      setAuthError('');
      setAuthChecked(true);
      setLoading(Boolean(nextSession));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !authChecked) return;
    if (!session?.user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from('admin_users')
      .select('*')
      .eq('user_id', session.user.id)
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
  }, [authChecked, session]);

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

function ConfiguratorApp({ initialScene }) {
  const initialOptions = initialScene.options || initialScene.source_payload?.options || {};
  const [width, setWidth] = useState(initialScene.dimensions?.width || 4);
  const [depth, setDepth] = useState(initialScene.dimensions?.depth || 3);
  const height = fixedWallHeight;
  const [layout, setLayout] = useState(initialScene.layout || 'u');
  const [items, setItems] = useState(initialScene.items?.length ? initialScene.items : [
    { id: 'table-1', type: 'table', x: -0.75, z: 0.3, y: 0, rotation: 0 },
    { id: 'chair-1', type: 'chair', x: 0.8, z: 0.45, y: 0, rotation: -15 },
    { id: 'screen-1', type: 'screen', x: 0, z: -1.5, y: 1.65, wall: 'back', rotation: 0 },
  ]);
  const [selectedId, setSelectedId] = useState('table-1');
  const [draggingId, setDraggingId] = useState(null);
  const [language, setLanguage] = useState('fr');
  const [headerPanel, setHeaderPanel] = useState(null);
  const [activeStep, setActiveStep] = useState(1);
  const [openOptions, setOpenOptions] = useState({ moquette: true, personnalisation: false, coton: false, reserve: false, tete: false });
  const [selectedCarpetId, setSelectedCarpetId] = useState(initialOptions.carpetColorId || '1893');
  const [selectedWallFabricId, setSelectedWallFabricId] = useState(initialOptions.wallFabricColorId || '303');
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const [saveState, setSaveState] = useState(initialScene.client_status || 'not_started');
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
  const [viewAngle] = useState(35);
  const hasMounted = useRef(false);

  const area = width * depth;
  const selected = items.find((item) => item.id === selectedId);
  const selectedCarpetColor = carpetColors.find((color) => color.id === selectedCarpetId) || carpetColors[0];
  const selectedWallFabricColor = wallFabricColors.find((color) => color.id === selectedWallFabricId) || wallFabricColors[0];
  const estimatedTotal = Math.round(area * 172.8);
  const salonLabel = initialScene.salon || clientInfo.event || 'SMCL 2026';
  const standLabel = initialScene.project_name || clientInfo.project || 'Stand A-14';
  const clientLabel = clientInfo.client || contactDetails.company || 'Aerosys Industries';
  const faceLabel = layout === 'u' ? '3 faces ouvertes' : layout === 'back' ? '1 face ouverte' : '2 faces ouvertes';
  const selectedLanguage = languages.find((entry) => entry.id === language) || languages[0];
  const availableCatalog = useMemo(() => {
    const dynamicEntries = objectBank
      .filter((asset) => asset.is_active)
      .filter((asset) => assetMatchesSalon(asset, salonLabel))
      .map(assetToCatalogEntry);
    const entries = [...catalog, ...dynamicEntries];
    return entries.filter((entry, index, all) => all.findIndex((item) => item.type === entry.type) === index);
  }, [objectBank, salonLabel]);

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
      items,
      options,
      source_payload: {
        ...(initialScene.source_payload || {}),
        options,
      },
    };
  };

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const alreadyConfigured = saveState === 'configured';
      saveScene(currentScenePayload(alreadyConfigured ? 'configured' : 'created', alreadyConfigured ? 'configured' : 'draft'))
        .then(() => {
          if (!alreadyConfigured) setSaveState('draft');
        })
        .catch((error) => console.error('Scene save failed', error));
    }, 800);

    return () => window.clearTimeout(timer);
  }, [width, depth, height, layout, items, clientInfo, selectedCarpetColor, selectedWallFabricColor, saveState]);

  useEffect(() => {
    listObjectBank()
      .then((assets) => setObjectBank(assets || []))
      .catch((error) => console.error('Object bank load failed', error));
  }, []);

  const validateConfiguration = async () => {
    await saveScene(currentScenePayload('configured', 'configured'));
    setSaveState('configured');
  };

  const toggleOption = (key) => {
    setOpenOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  const updateItem = (id, patch) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        return constrainItem(next, width, depth, layout);
      })
    );
  };

  const moveDraggedItem = (point) => {
    if (!draggingId) return;
    const dragged = items.find((item) => item.id === draggingId);
    if (!dragged) return;

    if (dragged.type === 'screen') {
      const wall = wallFromDrag(point, dragged.wall, width, depth, layout);
      updateItem(draggingId, { wall, x: wall === 'back' ? point.x : point.z });
      return;
    }

    updateItem(draggingId, { x: point.x, z: point.z });
  };

  const addItem = (entry) => {
    const item = makeItem(entry.type, width, depth, layout, entry);
    setItems((current) => [...current, item]);
    setSelectedId(item.id);
  };

  const chooseLayout = (nextLayout) => {
    setLayout(nextLayout);
    setItems((current) => current.map((item) => constrainItem(item, width, depth, nextLayout)));
  };

  const deleteSelectedItem = () => {
    if (!selected) return;
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

  return (
    <main className={`configurator-shell ${activeStep === 1 ? 'intro-step' : ''}`}>
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
          <span>Total estime</span>
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
            setDraggingId(null);
          }}
          onPointerLeave={() => {
            setDraggingId(null);
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
              items={items}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
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

        {activeStep === 1 && !headerPanel && (
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

        <div className={`view-toolbar ${selected ? 'selection-mode' : ''}`} aria-label={selected ? 'Actions objet selectionne' : 'Outils de vue'}>
          {selected ? (
            <>
              <button type="button" onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
              <button type="button" onClick={deleteSelectedItem} title="Supprimer"><Trash2 size={16} /></button>
              {rotationPanelOpen && selected.type !== 'screen' && (
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
        <div className="config-panel-head">
          <h1>Options de configuration</h1>
          <span>Etape {activeStep} / 4</span>
        </div>
        <div className="stand-summary-card">
          <strong>{area.toFixed(0)} m2 · {layout === 'u' ? '3 faces' : layout === 'back' ? '1 face' : '2 faces'} · {initialScene.project_name || 'Stand A-14'}</strong>
          <button type="button">Modifier ›</button>
        </div>
        <div className="rules-card">
          <strong>Regles SMCL appliquees automatiquement</strong>
          <span>✓ Reserve 2m2 incluse</span>
          <span>✓ 2 tetes de cloison</span>
          <span>✓ 9 spots LED (1/3m2)</span>
        </div>

        <section className="panel-section-title">Les options</section>
        <OptionAccordion title="Moquette" icon={<Layers size={16} />} open={openOptions.moquette} onToggle={() => toggleOption('moquette')}>
          <ColorOptionCard
            title="Couleur"
            colors={carpetColors}
            selectedColor={selectedCarpetColor}
            optionLabel="En option 36€"
            onSelect={setSelectedCarpetId}
          />
        </OptionAccordion>
        <OptionAccordion title="Personnalisation" icon={<Sparkles size={16} />} open={openOptions.personnalisation} onToggle={() => toggleOption('personnalisation')} />
        <OptionAccordion title="Coton cloison" icon={<Box size={16} />} open={openOptions.coton} onToggle={() => toggleOption('coton')}>
          <ColorOptionCard
            title="Couleur"
            colors={wallFabricColors}
            selectedColor={selectedWallFabricColor}
            optionLabel="En option 36€"
            onSelect={setSelectedWallFabricId}
          />
        </OptionAccordion>
        <OptionAccordion title="Reserve" icon={<Layers size={16} />} open={openOptions.reserve} onToggle={() => toggleOption('reserve')} />
        <OptionAccordion title="Tete de cloison" icon={<Ruler size={16} />} open={openOptions.tete} onToggle={() => toggleOption('tete')} />

        <section className="panel-section-title">Ajouter</section>
        <div className="compact-catalog">
          {availableCatalog.map((entry) => {
            const Icon = entry.icon;
            return (
              <button key={entry.type} onClick={() => addItem(entry)} title={`Ajouter ${entry.label}`}>
                <Icon size={16} />
                <span>{entry.label}</span>
                <Plus size={13} />
              </button>
            );
          })}
        </div>

        <details className="stand-settings">
          <summary>Dimensions et implantation</summary>
          <div className="settings-grid">
            <label>Largeur <span>{width} m</span><input type="range" min="2" max="8" step="0.5" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
            <label>Profondeur <span>{depth} m</span><input type="range" min="2" max="6" step="0.5" value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label>
            <div className="segmented config-layouts">
              {layouts.map((option) => (
                <button key={option.id} className={layout === option.id ? 'active' : ''} onClick={() => chooseLayout(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </details>

        <button className="wide export" onClick={() => exportTechnicalPng({ width, depth, layout, items, catalog: availableCatalog })}>
          <FileImage size={16} /> Generer PNG technique
        </button>
      </aside>
      )}

      {activeStep > 1 && (
      <footer className="configurator-footer">
        <div>
          <span>Total HT estime</span>
          <strong>{estimatedTotal.toLocaleString('fr-FR')} €</strong>
        </div>
        <nav>
          <button type="button" onClick={() => setActiveStep((step) => Math.max(1, step - 1))}>← Retour</button>
          <button type="button" onClick={() => setActiveStep((step) => Math.min(4, step + 1))}>Etape suivante →</button>
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

function ColorOptionCard({ title, colors, selectedColor, optionLabel, onSelect }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const includedColors = colors.filter((color) => color.included);
  const optionalColors = colors.filter((color) => !color.included);
  const selectColor = (colorId) => {
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
        <button className="color-dropdown-trigger" type="button" onClick={() => setDropdownOpen((open) => !open)}>
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

function AdminDashboard({ user, adminProfile }) {
  const [scenes, setScenes] = useState([]);
  const [clients, setClients] = useState([]);
  const [salons, setSalons] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetCategory, setAssetCategory] = useState('Tout');
  const [filters, setFilters] = useState({ search: '', salon: '', status: '' });
  const [tab, setTab] = useState('dashboard');
  const [accountOpen, setAccountOpen] = useState(false);
  const [syncState, setSyncState] = useState({ loading: false, message: '', error: '' });
  const [assetUploadState, setAssetUploadState] = useState({ loading: false, message: '', error: '' });
  const profile = getAdminProfile(user, adminProfile);

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
  const [boardEditor, setBoardEditor] = useState(null);
  const [actionState, setActionState] = useState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: '', error: '' });
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
    setActionState({ loadingPack: entry.packName, savingBoardPack: '', deletingPresetId: '', message: '', error: '' });
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
      setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: `${entry.packName} activé sur ${selectedSalon.name}.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible d’activer ce pack.' });
    }
  };

  const openBoardEditor = (entry) => {
    setBoardEditor({ packName: entry.packName, value: entry.source?.board_id || '' });
  };

  const saveBoardId = async (event, entry) => {
    event.preventDefault();
    if (!selectedSalon || !boardEditor) return;
    setActionState({ loadingPack: '', savingBoardPack: entry.packName, deletingPresetId: '', message: '', error: '' });
    try {
      await saveMondayBoardForPack(selectedSalon, entry.packName, boardEditor.value);
      setBoardEditor(null);
      setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: `Board Monday enregistré pour ${entry.packName}.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible d’enregistrer le board Monday.' });
    }
  };

  const removePreset = async (entry) => {
    if (!entry.preset) return;
    const confirmed = window.confirm(`Retirer le pack ${entry.packName} de ${selectedSalon?.name || 'ce salon'} ? Le board Monday restera configuré.`);
    if (!confirmed) return;

    setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: entry.preset.id, message: '', error: '' });
    try {
      await deleteStandPreset(entry.preset);
      setEditing((current) => (current?.preset?.id === entry.preset.id ? null : current));
      setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: `Pack ${entry.packName} retiré pour ce salon.`, error: '' });
      await onSalonChanged?.();
    } catch (error) {
      setActionState({ loadingPack: '', savingBoardPack: '', deletingPresetId: '', message: '', error: error.message || 'Impossible de retirer ce pack.' });
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
            <div className="preset-card-preview">{entry.active ? presetReferenceLabel(entry.preset) : '—'}</div>
            <div className="preset-card-body">
              <strong>{entry.salonShort} - {entry.packName}</strong>
              <span>{entry.active ? presetMetaLabel(entry.preset) : 'Pack non activé sur ce salon'}</span>
              <small className="preset-board-line">
                Monday : {entry.source?.board_id ? `board ${entry.source.board_id}` : 'aucun board'}
              </small>
              <div>
                {entry.active ? (
                  <>
                    <button className="primary" type="button" onClick={() => setEditing(entry)}>Modifier</button>
                    <button type="button" onClick={() => openBoardEditor(entry)}>
                      {entry.source?.board_id ? 'Modifier board' : 'Ajouter board ID'}
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
    </section>
  );
}

function salonPackCards(salon) {
  return defaultPackNames.map((packName) => {
    const offer = (salon.offers || []).find((item) => normalizeTextValue(item.name) === normalizeTextValue(packName)) || null;
    const preset = offer?.presets?.[0] || (salon.presets || []).find((item) => item.offer_id === offer?.id) || null;
    const source = offer?.monday_source || (salon.monday_sources || []).find((item) => normalizeTextValue(item.offer) === normalizeTextValue(packName)) || null;
    return {
      salon,
      salonShort: salonShortLabel(salon.name),
      offer,
      preset,
      source,
      packName,
      active: Boolean(offer && preset),
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

function AdminSalonPresetConfigurator({ salon, assets, initialOfferId = '', onClose, onSaved }) {
  const initialOffer = (salon.offers || []).find((offer) => offer.id === initialOfferId) || salon.offers?.[0] || null;
  const [localSalon, setLocalSalon] = useState(salon);
  const [saveState, setSaveState] = useState({ loading: false, message: '', error: '' });
  const selectedOffer = (localSalon.offers || []).find((offer) => offer.id === initialOfferId) || initialOffer || null;
  const activePreset = selectedOffer?.presets?.[0] || (localSalon.presets || []).find((preset) => preset.offer_id === selectedOffer?.id) || null;

  useEffect(() => {
    setLocalSalon(salon);
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
            ? { ...offer, presets: [savedPreset] }
            : offer
        )),
      }));
      setSaveState({ loading: false, message: 'Pack de base sauvegardé. Les prochaines scènes Monday reprendront ce placement.', error: '' });
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
            <p>Les objets enregistrés ici seront inclus automatiquement pour les exposants de ce pack, sans surcoût.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </header>

        <div className="preset-save-feedback-slot">
          {saveState.message && <div className="preset-save-feedback success">{saveState.message}</div>}
          {saveState.error && <div className="preset-save-feedback error">{saveState.error}</div>}
        </div>

        {activePreset ? (
          <PresetSceneEditor
            key={activePreset.id}
            salon={localSalon}
            offer={selectedOffer}
            preset={activePreset}
            assets={assets}
            saving={saveState.loading}
            onSave={savePreset}
          />
        ) : (
          <div className="admin-empty-row">Sélectionne ou ajoute un pack pour configurer sa scène de base.</div>
        )}
      </section>
    </div>
  );
}

function PresetSceneEditor({ salon, offer, preset, assets, saving, onSave }) {
  const initialScene = presetToEditableScene(preset);
  const [width, setWidth] = useState(initialScene.dimensions.width);
  const [depth, setDepth] = useState(initialScene.dimensions.depth);
  const height = fixedWallHeight;
  const [layout, setLayout] = useState(initialScene.layout);
  const [items, setItems] = useState(initialScene.items);
  const [selectedId, setSelectedId] = useState(initialScene.items[0]?.id || null);
  const [draggingId, setDraggingId] = useState(null);
  const [rotationPanelOpen, setRotationPanelOpen] = useState(false);
  const selected = items.find((item) => item.id === selectedId);
  const availableCatalog = useMemo(() => {
    const dynamicEntries = (assets || [])
      .filter((asset) => asset.is_active)
      .filter((asset) => assetMatchesSalon(asset, salon.name))
      .map(assetToCatalogEntry);
    const entries = [...catalog, ...dynamicEntries];
    return entries.filter((entry, index, all) => all.findIndex((item) => item.type === entry.type) === index);
  }, [assets, salon.name]);

  const updateItem = (id, patch) => {
    setItems((current) => current.map((item) => (item.id === id ? constrainItem({ ...item, ...patch }, width, depth, layout) : item)));
  };

  const moveDraggedItem = (point) => {
    if (!draggingId) return;
    const dragged = items.find((item) => item.id === draggingId);
    if (!dragged) return;
    if (dragged.type === 'screen') {
      const wall = wallFromDrag(point, dragged.wall, width, depth, layout);
      updateItem(draggingId, { wall, x: wall === 'back' ? point.x : point.z });
      return;
    }
    updateItem(draggingId, { x: point.x, z: point.z });
  };

  const addItem = (entry) => {
    const item = makeItem(entry.type, width, depth, layout, entry);
    setItems((current) => [...current, { ...item, label: entry.label }]);
    setSelectedId(item.id);
  };

  const chooseLayout = (nextLayout) => {
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
              <button type="button" onClick={() => setRotationPanelOpen((open) => !open)} title="Rotation"><RotateCcw size={16} /></button>
              <button type="button" onClick={() => { setItems((current) => current.filter((item) => item.id !== selected.id)); setSelectedId(null); }} title="Supprimer"><Trash2 size={16} /></button>
              {rotationPanelOpen && selected.type !== 'screen' && (
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
        <p>Ce pack est propre à ce salon. Un pack Business sur un autre salon aura son propre placement.</p>
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
    x: Number(item.x ?? config.x ?? 0),
    y: Number(item.y ?? config.y ?? 0),
    z: Number(item.z ?? config.z ?? 0),
    rotation: Number(item.rotation ?? config.rotation ?? 0),
    wall: item.wall || config.wall,
    modelUrl: config.modelUrl || catalogItem?.modelUrl,
    modelSize: config.modelSize || catalogItem?.modelSize,
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

function presetReferenceLabel(preset) {
  const area = presetArea(preset);
  return area ? `${area}m${presetFaceCount(preset)}F` : `${presetFaceCount(preset)}F`;
}

function presetMetaLabel(preset) {
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

function AdminObjectsView({ assets, scenes, search, category, selectedAsset, uploadState, onCategoryChange, onSelectAsset, onCloseAsset, onSaveAsset, onUploadAssetFolder }) {
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
          onClose={onCloseAsset}
          onSave={onSaveAsset}
          onDelete={() => onSaveAsset({ ...selectedAsset, is_active: false })}
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

function AssetDrawer({ asset, scenes, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(asset);
  const salons = getSalonRows(scenes).map((salon) => salon.title);
  const assignedSalons = assetSalons(draft, scenes);

  useEffect(() => setDraft(asset), [asset]);

  const toggleSalon = (salon) => {
    const current = new Set(assetSalons(draft, scenes));
    if (current.has(salon)) current.delete(salon);
    else current.add(salon);
    setDraft({
      ...draft,
      dimensions: {
        ...(draft.dimensions || {}),
        salons: [...current],
      },
    });
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
            return (
              <button key={salon} type="button" onClick={() => toggleSalon(salon)}>
                <strong>{salon}</strong>
                <span>{active ? 'Actif' : 'Inactif'}</span>
                <i className={active ? 'active' : ''} />
              </button>
            );
          })}
        </section>

        <small className="asset-price-note">Prix spécifique {assignedSalons[0] || 'salon'} : {draft.dimensions?.price ? `${draft.dimensions.price} €` : '—'}</small>

        <footer>
          <button type="button" className="asset-delete" onClick={onDelete}>Supprimer</button>
          <button type="button" className="asset-save" onClick={() => onSave(draft)}>Enregistrer les modifications</button>
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
    const children = rows
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
          color: source.dimensions?.color || source.color,
          lockedInGroup: true,
        };
      })
      .filter(Boolean);

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
                <label><span>X m</span><input type="number" step="0.05" value={row.x} onChange={(event) => updateRow(row.uid, { x: event.target.value })} /></label>
                <label><span>Z m</span><input type="number" step="0.05" value={row.z} onChange={(event) => updateRow(row.uid, { z: event.target.value })} /></label>
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
      x: Number(clamp(x, -half, half).toFixed(2)),
      z: Number(clamp(z, -half, half).toFixed(2)),
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
  const baseAssets = catalog
    .filter((entry) => !entry.isGroup && entry.type !== 'screen')
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
  const dynamicAssets = assets.filter((asset) => asset.is_active && !asset.dimensions?.isGroup && asset.type !== 'screen');
  const all = [...baseAssets, ...dynamicAssets];
  return all.filter((asset, index) => all.findIndex((candidate) => candidate.type === asset.type) === index);
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
  };
}

function assetModelSize(asset) {
  const size = asset.dimensions?.size || asset.dimensions?.dimensions || asset.dimensions?.modelSize;
  if (Array.isArray(size) && size.length >= 3) return size.map((value) => Number(value) || 0.7).slice(0, 3);
  return [1, 1, 1];
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

function constrainItem(item, width, depth, layout) {
  if (item.type === 'screen') {
    const validWalls = availableWalls(layout).map((wall) => wall.id);
    const wall = validWalls.includes(item.wall) ? item.wall : 'back';
    const range = screenAxisRange(wall, width, depth);
    const axis = clamp(item.x, range.min, range.max);
    return { ...item, wall, x: axis, z: wall === 'back' ? -depth / 2 + wallThickness : axis };
  }

  const bounds = itemGroupBounds(item);

  return {
    ...item,
    x: clamp(item.x, -width / 2 - bounds.minX, width / 2 - bounds.maxX),
    z: clamp(item.z, -depth / 2 - bounds.minZ, depth / 2 - bounds.maxZ),
  };
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

  if (!item.isGroup || !item.children?.length) return centeredBounds(item.modelSize || [0.7, 0.7, 0.7]);

  if (item.groupSize?.length >= 3) {
    const childBounds = item.children?.length ? childrenBounds(item.children) : null;
    if (childBounds) return childBounds;
    return centeredBounds(item.groupSize);
  }

  return childrenBounds(item.children) || centeredBounds();
}

function childrenBounds(children) {
  if (!children?.length) return null;
  const bounds = children.reduce((acc, child) => {
    const childSize = child.modelSize?.length >= 3
      ? { width: Number(child.modelSize[0]) || 0.5, depth: Number(child.modelSize[2]) || 0.5, height: Number(child.modelSize[1]) || 0.5 }
      : { width: 0.6, depth: 0.6, height: 0.6 };
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

function screenWorldPosition(item, width, depth) {
  const screenOffset = wallThickness + screenDepth / 2;
  if (item.wall === 'left') return [-width / 2 + screenOffset, item.y, item.x];
  if (item.wall === 'right') return [width / 2 - screenOffset, item.y, item.x];
  return [item.x, item.y, -depth / 2 + screenOffset];
}

function StandScene({ width, depth, height, layout, items, selectedId, setSelectedId, draggingId, setDraggingId, onDragMove, viewAngle, carpetColor, wallColor }) {
  const cameraPivot = useMemo(() => {
    const radians = (viewAngle * Math.PI) / 180;
    return [Math.sin(radians) * 0.75, 0, Math.cos(radians) * 0.25];
  }, [viewAngle]);

  const dragFromPointer = (event) => {
    if (!draggingId) return;
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
      <DragSurface width={width} depth={depth} sceneOffset={cameraPivot} draggingId={draggingId} onDragMove={onDragMove} />
      <Floor width={width} depth={depth} carpetColor={carpetColor} />
      <Grid width={width} depth={depth} />
      <Walls width={width} depth={depth} height={height} layout={layout} wallColor={wallColor} />
      <Text position={[0, 0.018, depth / 2 - 0.18]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.15} color="#6b6458">
        {width}m x {depth}m
      </Text>
      {items.map((item) => (
        <SceneItem
          key={item.id}
          item={item}
          width={width}
          depth={depth}
          selected={item.id === selectedId}
          dragging={item.id === draggingId}
          onSelect={() => setSelectedId(item.id)}
          onDragStart={(event) => {
            event.stopPropagation();
            event.target.setPointerCapture(event.pointerId);
            setSelectedId(item.id);
            setDraggingId(item.id);
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            event.target.releasePointerCapture(event.pointerId);
            setDraggingId(null);
          }}
          onDragMove={dragFromPointer}
        />
      ))}
    </group>
  );
}

function Floor({ width, depth, carpetColor }) {
  return (
    <mesh receiveShadow position={[0, -0.035, 0]}>
      <boxGeometry args={[width, 0.07, depth]} />
      <meshStandardMaterial color={carpetColor || '#bebebe'} roughness={0.78} />
    </mesh>
  );
}

function DragSurface({ width, depth, sceneOffset, draggingId, onDragMove }) {
  return (
    <mesh
      position={[0, 0.015, 0]}
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
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
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

function SceneItem({ item, selected, dragging, width, depth, onSelect, onDragStart, onDragEnd, onDragMove }) {
  const rotationY = (item.rotation * Math.PI) / 180;
  if (item.type === 'screen') return <Screen item={item} width={width} depth={depth} selected={selected} dragging={dragging} onSelect={onSelect} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragMove={onDragMove} />;
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
      <group position={[groupBounds.centerX, 0, groupBounds.centerZ]}>
        <ObjHitbox size={[groupBounds.width, Math.max(0.35, groupBounds.height), groupBounds.depth]} />
      </group>
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
          <ObjHitbox size={item.modelSize} />
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
  return (
    <mesh position={[0, Math.max(y, 0.35) / 2, 0]}>
      <boxGeometry args={[Math.max(x, 0.55), Math.max(y, 0.35), Math.max(z, 0.55)]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Model3D({ item, selected, dragging }) {
  if (item.modelUrl?.toLowerCase().split('?')[0].endsWith('.glb')) return <GlbModel item={item} />;
  if (item.materialUrl) return <ObjModelWithMaterials item={item} />;
  return <ObjModel item={item} selected={selected} dragging={dragging} />;
}

function GlbModel({ item }) {
  const gltf = useLoader(GLTFLoader, item.modelUrl);
  const model = useMemo(() => centerModel(gltf.scene.clone()), [gltf]);
  return <primitive object={model} />;
}

function ObjModelWithMaterials({ item }) {
  const materials = useLoader(MTLLoader, item.materialUrl);
  const obj = useLoader(OBJLoader, item.modelUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });
  const model = useMemo(() => {
    const clone = obj.clone();
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return centerModel(clone);
  }, [obj]);

  return <primitive object={model} />;
}

function ObjModel({ item, selected, dragging }) {
  const obj = useLoader(OBJLoader, item.modelUrl);
  const model = useMemo(() => {
    const clone = obj.clone();
    const material = new MeshStandardMaterial({
      color: activeColor(selected, dragging, item.color || '#ece7da'),
      roughness: 0.58,
      metalness: 0.03,
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

  return <primitive object={model} />;
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

function Screen({ item, width, depth, selected, dragging, onSelect, onDragStart, onDragEnd, onDragMove }) {
  const rotation = item.wall === 'left' ? Math.PI / 2 : item.wall === 'right' ? -Math.PI / 2 : 0;
  const offset = screenWorldPosition(item, width, depth);
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
      <mesh castShadow>
        <boxGeometry args={[0.95, 0.58, 0.06]} />
        <meshStandardMaterial color={activeColor(selected, dragging, '#182233')} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <boxGeometry args={[0.82, 0.45, 0.015]} />
        <meshStandardMaterial color="#67d7ff" emissive="#1c6887" emissiveIntensity={0.55} />
      </mesh>
    </group>
  );
}

createRoot(document.getElementById('root')).render(<App />);
