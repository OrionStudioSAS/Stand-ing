import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useLoader } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, Text } from '@react-three/drei';
import { Box3, MeshStandardMaterial, Plane, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  FileImage,
  LogOut,
  Plus,
  Search,
} from 'lucide-react';
import { supabase } from './data/supabaseClient.js';
import { catalog, layouts } from './config/catalog.js';
import { getSceneByToken, listScenes, saveScene, sceneShareUrl, syncMondayScenes } from './data/sceneStore.js';
import { exportTechnicalPng } from './technicalExport.js';
import './styles.css';

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const wallSwitchZone = 0.18;

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
  if (!sceneToken) return <AdminLogin mode="home" />;
  if (loading || !scene) return <div className="loading-screen">Chargement de la scene...</div>;

  return <ConfiguratorApp initialScene={scene} />;
}

function AdminGate() {
  const [session, setSession] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAdminUser(null);
      setAuthError('');
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) {
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
  }, [session]);

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

  if (loading) return <div className="loading-screen">Verification admin...</div>;
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
  const [clientInfoOpen, setClientInfoOpen] = useState(false);
  const [sceneInfoOpen, setSceneInfoOpen] = useState(true);
  const [placedObjectsOpen, setPlacedObjectsOpen] = useState(true);
  const [saveState, setSaveState] = useState(initialScene.client_status || 'not_started');
  const [clientInfo, setClientInfo] = useState({
    client: initialScene.client_name || '',
    project: initialScene.project_name || '',
    event: initialScene.event_name || initialScene.salon || '',
  });
  const [viewAngle] = useState(35);
  const hasMounted = useRef(false);

  const area = width * depth;
  const selected = items.find((item) => item.id === selectedId);

  const currentScenePayload = (status, clientStatus) => ({
        ...initialScene,
        status,
        client_status: clientStatus,
        client_name: clientInfo.client,
        project_name: clientInfo.project,
        event_name: clientInfo.event,
        dimensions: { width, depth, height },
        layout,
        items,
      });

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
  }, [width, depth, height, layout, items, clientInfo, saveState]);

  const validateConfiguration = async () => {
    await saveScene(currentScenePayload('configured', 'configured'));
    setSaveState('configured');
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

  const updateClientInfo = (key, value) => {
    setClientInfo((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="app-shell">
      <aside className="panel left-panel">
        <div className="brand">
          <span>StandING</span>
          <strong>Configurateur 3D</strong>
        </div>

        <section className="control-group">
          <div className="group-title">Dimensions</div>
          <label>
            Largeur <span>{width} m</span>
            <input type="range" min="2" max="8" step="0.5" value={width} onChange={(event) => setWidth(Number(event.target.value))} />
          </label>
          <label>
            Profondeur <span>{depth} m</span>
            <input type="range" min="2" max="6" step="0.5" value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
          </label>
          <label>
            Hauteur <span>{height} m</span>
            <input type="range" min="2" max="4" step="0.1" value={height} onChange={(event) => setHeight(Number(event.target.value))} />
          </label>
          <div className="metric">{area.toFixed(1)} m2</div>
        </section>

        <section className="control-group">
          <div className="group-title">Implantation</div>
          <div className="segmented">
            {layouts.map((option) => (
              <button key={option.id} className={layout === option.id ? 'active' : ''} onClick={() => chooseLayout(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="control-group">
          <div className="group-title">Ajouter</div>
          <div className="catalog">
            {catalog.map((entry) => {
              const Icon = entry.icon;
              return (
                <button key={entry.type} onClick={() => addItem(entry.type)} title={`Ajouter ${entry.label}`}>
                  <Icon size={18} />
                  <span>{entry.label}</span>
                  <Plus size={14} />
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="stage">
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
          <color attach="background" args={['#e9ece4']} />
          <fog attach="fog" args={['#e9ece4', 9, 18]} />
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

        <div className="scene-info-card">
          <label className="language-field">
            Langue
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="fr">Francais</option>
              <option value="en">English</option>
            </select>
          </label>
          <button className="accordion-trigger" onClick={() => setClientInfoOpen((open) => !open)} aria-expanded={clientInfoOpen}>
            <span>Mes informations</span>
            <strong>{clientInfoOpen ? '-' : '+'}</strong>
          </button>
          {clientInfoOpen && (
            <div className="client-info-grid">
              <label>
                Client
                <input value={clientInfo.client} placeholder="Nom du client" onChange={(event) => updateClientInfo('client', event.target.value)} />
              </label>
              <label>
                Projet
                <input value={clientInfo.project} placeholder="Nom du projet" onChange={(event) => updateClientInfo('project', event.target.value)} />
              </label>
              <label>
                Salon
                <input value={clientInfo.event} placeholder="Salon / hall / stand" onChange={(event) => updateClientInfo('event', event.target.value)} />
              </label>
            </div>
          )}
          <button className="accordion-trigger" onClick={() => setSceneInfoOpen((open) => !open)} aria-expanded={sceneInfoOpen}>
            <span>Informations scene client</span>
            <strong>{sceneInfoOpen ? '-' : '+'}</strong>
          </button>
          {sceneInfoOpen && (
            <div className="scene-info-grid">
              <span>Surface</span>
              <strong>{area.toFixed(1)} m2</strong>
              <span>Dimensions</span>
              <strong>{width} x {depth} x {height} m</strong>
              <span>Implantation</span>
              <strong>{layoutLabel(layout)}</strong>
              <span>Objets</span>
              <strong>{items.length}</strong>
            </div>
          )}
        </div>

        <div className="scene-actions-card">
          <button className="accordion-trigger" onClick={() => setPlacedObjectsOpen((open) => !open)} aria-expanded={placedObjectsOpen}>
            <span>Objets poses</span>
            <strong>{placedObjectsOpen ? '-' : '+'}</strong>
          </button>
          {placedObjectsOpen && (
            <div className="placed-object-list" role="listbox" aria-label="Objets poses">
              {items.map((item, index) => (
                <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
                  <span>{index + 1}. {catalog.find((entry) => entry.type === item.type)?.label}</span>
                  <small>{item.type === 'screen' ? wallLabel(item.wall) : `${item.x.toFixed(1)}, ${item.z.toFixed(1)}`}</small>
                </button>
              ))}
            </div>
          )}
          {selected && selected.type !== 'screen' && (
            <label className="rotation-control">
              Rotation <span>{selected.rotation || 0} deg</span>
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
          <button className="wide validate" onClick={validateConfiguration}>
            Valider ma configuration
          </button>
          <button className="wide export" onClick={() => exportTechnicalPng({ width, depth, height, layout, items, catalog })}>
            <FileImage size={16} /> Generer PNG technique
          </button>
        </div>
      </section>
    </main>
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

function StandScene({ width, depth, height, layout, items, selectedId, setSelectedId, draggingId, setDraggingId, onDragMove, viewAngle }) {
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
      <Floor width={width} depth={depth} />
      <Grid width={width} depth={depth} />
      <Walls width={width} depth={depth} height={height} layout={layout} />
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

function Floor({ width, depth }) {
  const texture = useLoader(TextureLoader, '/textures/floor-laminate.jpg');
  const floorMap = useMemo(() => {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    texture.repeat.set(Math.max(width / 1.2, 1), Math.max(depth / 1.2, 1));
    texture.needsUpdate = true;
    return texture;
  }, [texture, width, depth]);

  return (
    <mesh receiveShadow position={[0, -0.035, 0]}>
      <boxGeometry args={[width, 0.07, depth]} />
      <meshStandardMaterial map={floorMap} color="#f8f5ea" roughness={0.72} />
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

function Walls({ width, depth, height, layout }) {
  return (
    <group>
      <Wall position={[0, height / 2, -depth / 2]} size={[width, height, 0.12]} />
      {(layout === 'left' || layout === 'u') && <Wall position={[-width / 2, height / 2, 0]} size={[0.12, height, depth]} />}
      {(layout === 'right' || layout === 'u') && <Wall position={[width / 2, height / 2, 0]} size={[0.12, height, depth]} />}
    </group>
  );
}

function Wall({ position, size }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#fffdf4" roughness={0.62} />
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
