import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useLoader } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Text } from '@react-three/drei';
import { Box3, MeshStandardMaterial, Plane, Vector3 } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  FileImage,
  HelpCircle,
  Layers,
  LogOut,
  Mail,
  Maximize2,
  Minus,
  Paperclip,
  Plus,
  RotateCcw,
  Ruler,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from './data/supabaseClient.js';
import { catalog, layouts } from './config/catalog.js';
import { carpetColors, wallFabricColors } from './config/colorOptions.js';
import { getSceneByToken, listScenes, saveScene, sceneShareUrl, syncMondayScenes } from './data/sceneStore.js';
import { exportTechnicalPng } from './technicalExport.js';
import './styles.css';

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const wallSwitchZone = 0.18;
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

function makeItem(type, width, depth, layout) {
  const entry = catalog.find((item) => item.type === type);
  const base = {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type,
    rotation: 0,
  };

  if (type === 'screen') {
    const side = layout === 'right' ? 'right' : layout === 'left' ? 'left' : 'back';
    return {
      ...base,
      wall: side,
      x: 0,
      z: side === 'back' ? -depth / 2 : 0,
      y: 1.65,
    };
  }

  return {
    ...base,
    modelUrl: entry?.modelUrl,
    modelSize: entry?.modelSize,
    color: entry?.color,
    x: 0,
    z: Math.min(depth / 2 - 0.9, 0.7),
    y: 0,
  };
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

  useEffect(() => {
    if (isAdmin) return;
    if (!sceneToken) {
      setLoading(false);
      return;
    }

    getSceneByToken(sceneToken)
      .then((loaded) => setScene(loaded))
      .finally(() => setLoading(false));
  }, [isAdmin, sceneToken]);

  if (isAdmin) return <AdminGate />;
  if (!sceneToken) return <HomeGate />;
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

  return <AdminDashboard user={session.user} />;
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

function AdminLogin({ authError = '', mode = 'admin' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [configLink, setConfigLink] = useState('');
  const [showConfigLink, setShowConfigLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(authError);

  useEffect(() => setError(authError), [authError]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError('Email ou mot de passe incorrect.');
      setLoading(false);
      return;
    }

    window.location.href = '/admin';
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
        <button className="login-submit" disabled={loading}>
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
  const [height, setHeight] = useState(initialScene.dimensions?.height || 2.5);
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

  const addItem = (type) => {
    const item = makeItem(type, width, depth, layout);
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
          {catalog.map((entry) => {
            const Icon = entry.icon;
            return (
              <button key={entry.type} onClick={() => addItem(entry.type)} title={`Ajouter ${entry.label}`}>
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
            <label>Hauteur <span>{height} m</span><input type="range" min="2" max="4" step="0.1" value={height} onChange={(event) => setHeight(Number(event.target.value))} /></label>
            <div className="segmented config-layouts">
              {layouts.map((option) => (
                <button key={option.id} className={layout === option.id ? 'active' : ''} onClick={() => chooseLayout(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </details>

        <button className="wide export" onClick={() => exportTechnicalPng({ width, depth, height, layout, items, catalog })}>
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

function AdminDashboard({ user }) {
  const [scenes, setScenes] = useState([]);
  const [filters, setFilters] = useState({ search: '', salon: '', status: '' });
  const [tab, setTab] = useState('stands');
  const [syncState, setSyncState] = useState({ loading: false, message: '', error: '' });

  useEffect(() => {
    listScenes(filters).then(setScenes).catch((error) => console.error('Scene list failed', error));
  }, [filters]);

  const refreshScenes = () => {
    return listScenes(filters).then(setScenes).catch((error) => console.error('Scene list failed', error));
  };

  const runMondaySync = async () => {
    setSyncState({ loading: true, message: '', error: '' });
    try {
      const result = await syncMondayScenes();
      await refreshScenes();
      setSyncState({
        loading: false,
        message: `${result?.processed ?? 0} scene(s) synchronisee(s) depuis Monday.`,
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

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <span>StandING admin</span>
          <h1>Scenes clients</h1>
        </div>
        <div className="admin-header-actions">
          <small>{user?.email}</small>
          <a href="/?scene=smcl-confort-demo">Voir scene SMCL</a>
          <button onClick={() => supabase.auth.signOut()}>
            <LogOut size={16} /> Deconnexion
          </button>
        </div>
      </header>

      <nav className="admin-tabs">
        <button className={tab === 'stands' ? 'active' : ''} onClick={() => setTab('stands')}>Stands crees</button>
        <button className={tab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}>Banque d'objets 3D</button>
        <button className={tab === 'monday' ? 'active' : ''} onClick={() => setTab('monday')}>Monday sync</button>
      </nav>

      {tab === 'stands' && (
        <>
          <section className="admin-filters">
            <label>
              Recherche
              <div className="search-field">
                <Search size={16} />
                <input value={filters.search} placeholder="Client, salon, projet..." onChange={(event) => updateFilter('search', event.target.value)} />
              </div>
            </label>
            <label>
              Salon
              <input value={filters.salon} placeholder="SMCL" onChange={(event) => updateFilter('salon', event.target.value)} />
            </label>
            <label>
              Statut
              <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
                <option value="">Tous</option>
                <option value="created">Cree</option>
                <option value="configured">Configure</option>
                <option value="bat_pending">BAT a valider</option>
                <option value="validated">Valide</option>
              </select>
            </label>
          </section>

          <section className="admin-table">
            {scenes.map((scene) => (
              <article key={scene.id} className="stand-row">
                <div>
                  <strong>{scene.client_name || 'Client sans nom'}</strong>
                  <span>{scene.salon} / {scene.offer} / {scene.project_name}</span>
                </div>
                <div>
                  <span>Statut</span>
                  <strong>{statusLabel(scene.status)}</strong>
                </div>
                <div>
                  <span>Client</span>
                  <strong>{clientStatusLabel(scene.client_status)}</strong>
                </div>
                <div>
                  <span>Fichiers</span>
                  <strong>{fileSummary(scene.files)}</strong>
                </div>
                <div className="stand-actions">
                  <a href={sceneShareUrl(scene)}>Voir scene</a>
                  {(scene.files || []).map((file) => (
                    <a key={file.id || file.storage_path || file.file_name} href={file.public_url || '#'}>{fileTypeLabel(file.type)}</a>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {tab === 'objects' && (
        <section className="object-bank">
          {catalog.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.type}>
                <Icon size={20} />
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.modelUrl ? 'Modele OBJ' : 'Objet natif'}</span>
                </div>
                <button>Ajouter a une scene</button>
              </article>
            );
          })}
        </section>
      )}

      {tab === 'monday' && (
        <section className="monday-panel">
          <h2>Synchronisation Monday</h2>
          <p>Lit les tableaux SMCL Confort/Prestige, cree une scene quand la colonne CONFIGURABLE vaut OUI, puis remplit le lien configurateur dans Monday.</p>
          <button className="sync-button" onClick={runMondaySync} disabled={syncState.loading}>
            {syncState.loading ? 'Synchronisation...' : 'Synchroniser Monday'}
          </button>
          {syncState.message && <div className="sync-result success">{syncState.message}</div>}
          {syncState.error && <div className="sync-result error">{syncState.error}</div>}
        </section>
      )}
    </main>
  );
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
    return { ...item, wall, x: axis, z: wall === 'back' ? -depth / 2 : axis };
  }

  return {
    ...item,
    x: clamp(item.x, -width / 2 + 0.35, width / 2 - 0.35),
    z: clamp(item.z, -depth / 2 + 0.35, depth / 2 - 0.35),
  };
}

function screenWorldPosition(item, width, depth) {
  if (item.wall === 'left') return [-width / 2 + 0.095, item.y, item.x];
  if (item.wall === 'right') return [width / 2 - 0.095, item.y, item.x];
  return [item.x, item.y, -depth / 2 + 0.075];
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
  return (
    <group>
      <Wall position={[0, height / 2, -depth / 2]} size={[width, height, 0.12]} color={wallColor} />
      {(layout === 'left' || layout === 'u') && <Wall position={[-width / 2, height / 2, 0]} size={[0.12, height, depth]} color={wallColor} />}
      {(layout === 'right' || layout === 'u') && <Wall position={[width / 2, height / 2, 0]} size={[0.12, height, depth]} color={wallColor} />}
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
      {item.type === 'chair' && <Chair selected={selected} dragging={dragging} />}
      {item.type === 'table' && <Table selected={selected} dragging={dragging} />}
      {item.type === 'counter' && <Counter selected={selected} dragging={dragging} />}
      {item.modelUrl && (
        <>
          <ObjHitbox size={item.modelSize} />
          <ObjModel item={item} selected={selected} dragging={dragging} />
        </>
      )}
    </group>
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

    const box = new Box3().setFromObject(clone);
    const center = box.getCenter(new Vector3());
    clone.position.set(-center.x, -box.min.y, -center.z);

    return clone;
  }, [obj, item.color, selected, dragging]);

  return <primitive object={model} />;
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
