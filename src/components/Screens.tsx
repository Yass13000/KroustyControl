import { useMemo, useState, type ChangeEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, Film, Hourglass, ImagePlus, LayoutGrid, Monitor, MonitorPlay, Plus, Search, Store, Trash2, Unplug, UserRound } from 'lucide-react';
import { sbClient } from '../lib/supabase';
import { errorMessage, must, useAccounts, useLibrary } from '../lib/data';
import { FORMATS, fileNameFromUrl, isOnline, parseFormat, parsePlaylist, timeAgo, transformStorageUrl } from '../lib/media';
import type { AppScreen, Configuration, Group, Profile } from '../lib/types';
import { Badge, Button, EmptyState, IconButton, Input, Modal, PageTitle, Segmented, Select, Spinner, StatusDot, cn, useFeedback } from './ui';

export type { AppScreen } from '../lib/types';

interface ScreensProps {
  groups: Group[];
  configurations: Configuration[];
  screens: AppScreen[];
  isSuperAdmin: boolean;
  loading: boolean;
  onChanged: () => void;
  now: number;
}

/** Valeurs d'un écran remis « en attente » (non assigné). */
const UNASSIGNED = {
  configuration_id: null,
  total_cols: 1,
  total_rows: 1,
  pos_x: 0,
  pos_y: 0,
  video_url: '',
  audio_url: '',
};

export default function Screens({ groups, configurations, screens, isSuperAdmin, loading, onChanged, now }: ScreensProps) {
  const { toast, confirm } = useFeedback();

  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupImageUrl, setNewGroupImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'restaurants' | 'all' | 'unassigned'>('restaurants');
  const [statusFilter, setStatusFilter] = useState<'any' | 'online' | 'offline'>('any');
  const library = useLibrary();
  const accounts = useAccounts(isSuperAdmin);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [newConfigName, setNewConfigName] = useState('');
  const [newConfigFormat, setNewConfigFormat] = useState('1x1');
  const [assignTarget, setAssignTarget] = useState<{ configId: string; format: string; x: number; y: number; displayNum: number } | null>(null);

  // Les objets sélectionnés sont dérivés des données : s'ils disparaissent (temps réel), la modale se ferme seule.
  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null;
  const selectedConfig = selectedGroup ? configurations.find(c => c.id === selectedConfigId && c.group_id === selectedGroup.id) || null : null;

  const online = (s: AppScreen) => isOnline(s.last_ping, now);
  const unassignedScreens = useMemo(() => screens.filter(s => !s.configuration_id), [screens]);
  const filteredGroups = groups.filter(g => g.name?.toLowerCase().includes(searchQuery.toLowerCase()));

  /** Exécute une action, affiche le résultat et rafraîchit les données. */
  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) toast(success);
      onChanged();
      return true;
    } catch (err) {
      console.error(err);
      toast(errorMessage(err), 'error');
      return false;
    }
  };

  /* ------------------------------ Images ------------------------------ */

  const uploadRestaurantImage = async (file: File, prefix: string) => {
    const ext = file.name.split('.').pop();
    const path = `${prefix}-${Date.now()}.${ext}`;
    must(await sbClient.storage.from('medias').upload(path, file, { upsert: true }));
    return sbClient.storage.from('medias').getPublicUrl(path).data.publicUrl;
  };

  const handleCreateImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingImage(true);
    try {
      setNewGroupImageUrl(await uploadRestaurantImage(file, 'new-restaurant'));
    } catch (err) {
      toast(`Envoi de l'image impossible : ${errorMessage(err)}`, 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleGroupImageChange = async (e: ChangeEvent<HTMLInputElement>, groupId: string) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingImage(true);
    await run(async () => {
      const url = await uploadRestaurantImage(file, `group-${groupId}`);
      must(await sbClient.from('groups').update({ image_url: url }).eq('id', groupId));
    }, 'Photo mise à jour');
    setUploadingImage(false);
  };

  /* ------------------------------ Actions ------------------------------ */

  const submitNewGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCreating(true);
    const ok = await run(
      async () => must(await sbClient.from('groups').insert([{ name, image_url: newGroupImageUrl.trim() || null }])),
      `Restaurant « ${name} » créé`,
    );
    setCreating(false);
    if (ok) {
      setNewGroupName('');
      setNewGroupImageUrl('');
      setShowCreateForm(false);
    }
  };

  const createNewConfiguration = async () => {
    const name = newConfigName.trim();
    if (!name || !selectedGroup) return;
    const ok = await run(
      async () => must(await sbClient.from('configurations').insert([{ group_id: selectedGroup.id, name, format: newConfigFormat }])),
      'Configuration créée',
    );
    if (ok) setNewConfigName('');
  };

  const deleteGroup = async (group: Group) => {
    const ok = await confirm({
      title: `Supprimer « ${group.name} » ?`,
      message: 'Ses écrans repasseront en attente.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const configIds = configurations.filter(c => c.group_id === group.id).map(c => c.id);
      if (configIds.length > 0) {
        must(await sbClient.from('screens_config').update(UNASSIGNED).in('configuration_id', configIds));
        must(await sbClient.from('configurations').delete().in('id', configIds));
      }
      must(await sbClient.from('groups').delete().eq('id', group.id));
      setSelectedGroupId(null);
      setSelectedConfigId(null);
    }, 'Restaurant supprimé');
  };

  const deleteConfiguration = async (config: Configuration) => {
    const ok = await confirm({
      title: `Supprimer « ${config.name} » ?`,
      message: 'Ses écrans repasseront en attente.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      must(await sbClient.from('screens_config').update(UNASSIGNED).eq('configuration_id', config.id));
      must(await sbClient.from('configurations').delete().eq('id', config.id));
      if (selectedConfigId === config.id) setSelectedConfigId(null);
    }, 'Configuration supprimée');
  };

  const deleteScreen = async (screenId: string) => {
    const ok = await confirm({ title: `Supprimer l'appareil ${screenId} ?`, confirmLabel: 'Supprimer', danger: true });
    if (ok) await run(async () => must(await sbClient.from('screens_config').delete().eq('id', screenId)), 'Appareil supprimé');
  };

  const changeConfigFormat = async (config: Configuration, nextFormat: string) => {
    const { rows, cols } = parseFormat(nextFormat);
    const willDetach = screens.filter(s => s.configuration_id === config.id && (s.pos_x >= cols || s.pos_y >= rows)).length;
    if (willDetach > 0) {
      const ok = await confirm({
        title: `Passer en ${nextFormat} ?`,
        message: `${willDetach} écran${willDetach > 1 ? 's' : ''} hors de la nouvelle grille repasser${willDetach > 1 ? 'ont' : 'a'} en attente.`,
        confirmLabel: 'Changer le format',
      });
      if (!ok) return;
    }
    await run(async () => {
      must(
        await sbClient
          .from('screens_config')
          .update(UNASSIGNED)
          .eq('configuration_id', config.id)
          .or(`pos_x.gte.${cols},pos_y.gte.${rows}`),
      );
      must(
        await sbClient
          .from('screens_config')
          .update({ total_cols: cols, total_rows: rows })
          .eq('configuration_id', config.id)
          .lt('pos_x', cols)
          .lt('pos_y', rows),
      );
      must(await sbClient.from('configurations').update({ format: nextFormat }).eq('id', config.id));
    }, 'Format mis à jour');
  };

  const resetScreen = async (screenId: string) => {
    const ok = await confirm({ title: `Retirer ${screenId} ?`, confirmLabel: 'Retirer' });
    if (ok) await run(async () => must(await sbClient.from('screens_config').update(UNASSIGNED).eq('id', screenId)), 'Écran retiré');
  };

  const submitAssign = async (screenId: string) => {
    if (!assignTarget) return;
    const { configId, format, x, y } = assignTarget;
    const { rows, cols } = parseFormat(format);
    setAssignTarget(null);
    await run(
      async () =>
        must(
          await sbClient
            .from('screens_config')
            .update({ configuration_id: configId, pos_x: x, pos_y: y, total_cols: cols, total_rows: rows })
            .eq('id', screenId),
        ),
      'Écran rattaché',
    );
  };

  /* ------------------------------ Propriétaires (admin) ------------------------------ */

  const setScreenOwner = async (screenId: string, userId: string | null) => {
    try {
      const res = await sbClient.from('screens_config').update({ user_id: userId }).eq('id', screenId);
      if (res.error) {
        if (res.error.message.includes('user_id')) {
          toast('Migration 20261110_screens_owner.sql manquante', 'error');
          return;
        }
        throw res.error;
      }
      toast(userId ? 'Écran lié' : 'Écran délié');
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const setGroupOwner = (groupId: string, userId: string | null) =>
    run(
      async () => must(await sbClient.from('groups').update({ user_id: userId }).eq('id', groupId)),
      userId ? 'Restaurant lié' : 'Restaurant délié',
    );

  /* ------------------------------ Grille de la configuration ------------------------------ */

  const renderConfigGrid = (config: Configuration) => {
    const { rows, cols } = parseFormat(config.format);
    const inConfig = screens.filter(s => s.configuration_id === config.id);
    const slots = [];
    let n = 1;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const slot = n;
        const s = inConfig.find(scr => scr.pos_x === x && scr.pos_y === y);

        if (s) {
          const playlist = parsePlaylist(s.video_url);
          const firstUrl = playlist[0] || '';
          const previewUrl = transformStorageUrl(firstUrl);
          slots.push(
            <div key={s.id} className="relative flex h-32 flex-col overflow-hidden rounded-2xl bg-ink">
              {previewUrl && (
                <video
                  key={previewUrl}
                  src={previewUrl}
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500"
                  onLoadedData={e => (e.currentTarget.style.opacity = '0.5')}
                />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/60" />
              <div className="relative z-10 flex h-full flex-col justify-between p-2.5">
                <div className="flex items-start justify-between">
                  <StatusDot online={online(s)} className="mt-1" />
                  {isSuperAdmin && (
                    <IconButton label={`Retirer ${s.id}`} variant="onDark" size="sm" onClick={() => resetScreen(s.id)}>
                      <Unplug className="h-4 w-4" />
                    </IconButton>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-white">{s.id}</p>
                  {firstUrl && (
                    <p className="truncate text-xs text-white/65">
                      {videoNameByUrl(firstUrl)}
                      {playlist.length > 1 && ` +${playlist.length - 1}`}
                    </p>
                  )}
                </div>
              </div>
            </div>,
          );
        } else {
          slots.push(
            <button
              key={`empty-${y}-${x}`}
              type="button"
              disabled={!isSuperAdmin}
              onClick={() => setAssignTarget({ configId: config.id, format: config.format, x, y, displayNum: slot })}
              className={cn(
                'flex h-32 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line bg-cream/60 text-center transition',
                isSuperAdmin ? 'hover:border-brand/50 hover:bg-brand-50 active:scale-[0.98]' : 'cursor-default opacity-70',
              )}
            >
              {isSuperAdmin ? <Plus className="h-6 w-6 text-brand" aria-label="Assigner un écran" /> : <span className="text-sm font-bold text-muted/40">—</span>}
            </button>,
          );
        }
        n++;
      }
    }

    return (
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {slots}
      </div>
    );
  };

  /* ------------------------------ Vue « Tous les écrans » ------------------------------ */

  const videoNameByUrl = (url: string) => library.videos.find(v => v.url === url)?.name || fileNameFromUrl(url) || 'Vidéo externe';

  const renderAllScreens = () => {
    const configById = new Map(configurations.map(c => [c.id, c]));
    const groupById = new Map(groups.map(g => [g.id, g]));
    const q = searchQuery.trim().toLowerCase();

    const rows = screens
      .map(s => {
        const config = s.configuration_id ? configById.get(s.configuration_id) : undefined;
        const group = config ? groupById.get(config.group_id) : undefined;
        return { s, config, group, on: online(s) };
      })
      .filter(({ s, config, group, on }) => {
        if (statusFilter === 'online' && !on) return false;
        if (statusFilter === 'offline' && on) return false;
        if (!q) return true;
        return [s.id, config?.name, group?.name].some(v => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => Number(b.on) - Number(a.on) || (a.group?.name || '~').localeCompare(b.group?.name || '~', 'fr') || a.s.id.localeCompare(b.s.id, 'fr'));

    if (rows.length === 0) {
      return <EmptyState icon={<MonitorPlay className="h-6 w-6" />} title="Aucun écran" text={q || statusFilter !== 'any' ? 'Aucun écran ne correspond à ces filtres.' : undefined} />;
    }

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ s, config, group, on }) => {
          const playlist = parsePlaylist(s.video_url);
          const first = playlist[0];
          const preview = first ? transformStorageUrl(first) : '';
          const thumb = first ? library.videos.find(v => v.url === first)?.thumbnail || '' : '';

          return (
            <div key={s.id} className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift">
            <button
              type="button"
              onClick={() => {
                if (config && group) {
                  setSelectedGroupId(group.id);
                  setSelectedConfigId(config.id);
                } else if (isSuperAdmin) {
                  setView('unassigned');
                }
              }}
              className="block w-full text-left active:scale-[0.99]"
            >
              <div className="relative aspect-[16/7] bg-ink sm:aspect-video">
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-85" />
                ) : preview ? (
                  <video
                    src={`${preview}#t=0.5`}
                    muted
                    playsInline
                    preload="metadata"
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-white/25">
                    <Monitor className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40" />
                <p className="absolute inset-x-3 bottom-2 flex items-center gap-2 text-base font-extrabold text-white drop-shadow">
                  <StatusDot online={on} />
                  <span className="truncate">{s.id}</span>
                </p>
              </div>

              <div className="space-y-1 p-3.5">
                {config && group ? (
                  <p className="truncate text-sm font-bold text-ink">
                    {group.name}
                    <span className="font-medium text-muted"> · {config.name}</span>
                  </p>
                ) : (
                  <Badge tone="neutral">En attente</Badge>
                )}
                <p className="flex items-center gap-1.5 truncate text-sm text-muted">
                  <Film className="h-4 w-4 flex-shrink-0 text-brand" />
                  {first ? (
                    <span className="truncate">
                      {videoNameByUrl(first)}
                      {playlist.length > 1 && <span className="font-semibold"> +{playlist.length - 1}</span>}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </p>
                {!on && <p className="text-xs text-muted/70">{timeAgo(s.last_ping, now)}</p>}
              </div>
            </button>
            {isSuperAdmin && (
              <div className="mt-auto border-t border-sand px-3.5 py-2.5">
                <OwnerSelect accounts={accounts} value={s.user_id ?? null} onChange={id => setScreenOwner(s.id, id)} />
              </div>
            )}
            </div>
          );
        })}
      </div>
    );
  };

  /* ------------------------------ Page ------------------------------ */

  if (loading && groups.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const groupConfigs = selectedGroup ? configurations.filter(c => c.group_id === selectedGroup.id) : [];

  return (
    <div className="space-y-5">
      <PageTitle
        title="Écrans"
        actions={
          isSuperAdmin && (
            <IconButton label="Nouveau restaurant" variant="secondary" onClick={() => setShowCreateForm(v => !v)}>
              <Plus className={cn('h-5 w-5 transition-transform', showCreateForm && 'rotate-45')} />
            </IconButton>
          )
        }
      />

      {isSuperAdmin && showCreateForm && (
        <form
          className="card space-y-3 p-4 animate-in fade-in slide-in-from-top-2 duration-200"
          onSubmit={e => {
            e.preventDefault();
            submitNewGroup();
          }}
        >
          <div className="flex items-center gap-3">
            <label
              className="relative flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-cream text-muted transition hover:border-brand/50"
              title="Ajouter une photo"
            >
              {uploadingImage ? (
                <Spinner className="h-5 w-5" />
              ) : newGroupImageUrl ? (
                <img src={newGroupImageUrl} className="h-full w-full object-cover" alt="" />
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
              <input type="file" accept="image/*" onChange={handleCreateImageUpload} className="sr-only" />
            </label>
            <Input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Nom" autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreateForm(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={creating} disabled={!newGroupName.trim() || uploadingImage}>
              Enregistrer
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2.5">
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'restaurants', label: 'Restaurants' },
              { value: 'all', label: 'Écrans' },
              ...(isSuperAdmin
                ? [{ value: 'unassigned' as const, label: unassignedScreens.length > 0 ? `En attente · ${unassignedScreens.length}` : 'En attente' }]
                : []),
            ]}
          />
        </div>
        {view !== 'unassigned' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher"
                leading={<Search className="h-4.5 w-4.5" />}
                aria-label="Rechercher"
              />
            </div>
            {view === 'all' && (
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'any', label: 'Tous' },
                  { value: 'online', label: String(screens.filter(online).length), title: 'En ligne', icon: <StatusDot online className="h-2 w-2" /> },
                  { value: 'offline', label: String(screens.filter(x => !online(x)).length), title: 'Hors ligne', icon: <StatusDot online={false} className="h-2 w-2" /> },
                ]}
              />
            )}
          </div>
        )}
      </div>

      {view === 'all' ? (
        renderAllScreens()
      ) : view === 'unassigned' && isSuperAdmin ? (
        unassignedScreens.length === 0 ? (
          <EmptyState icon={<Hourglass className="h-6 w-6" />} title="Aucun écran en attente" />
        ) : (
          <section className="card p-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {unassignedScreens.map(s => (
                <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-sand bg-cream/60 p-3">
                  <StatusDot online={online(s)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{s.id}</span>
                  <IconButton label={`Supprimer ${s.id}`} variant="danger" size="sm" onClick={() => deleteScreen(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          </section>
        )
      ) : filteredGroups.length === 0 ? (
        <EmptyState icon={<Store className="h-6 w-6" />} title={searchQuery ? 'Aucun résultat' : 'Aucun restaurant'} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {filteredGroups.map(group => {
            const configIds = new Set(configurations.filter(c => c.group_id === group.id).map(c => c.id));
            const inGroup = screens.filter(s => s.configuration_id && configIds.has(s.configuration_id));
            const onlineCount = inGroup.filter(online).length;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setSelectedGroupId(group.id);
                  setSelectedConfigId(null);
                }}
                className="group relative flex aspect-square w-full flex-col justify-end overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-800 p-4 text-left shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98]"
              >
                {group.image_url && (
                  <img
                    src={group.image_url}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/0" />
                {!group.image_url && <Store className="absolute right-4 top-4 h-7 w-7 text-white/40" />}

                <div className="relative z-10">
                  <h3 className="line-clamp-2 text-base font-extrabold uppercase leading-tight text-white drop-shadow sm:text-lg">{group.name}</h3>
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-sm font-bold tabular-nums text-white backdrop-blur" title="En ligne">
                    <StatusDot online={onlineCount > 0} className="h-2 w-2" />
                    {onlineCount}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ======================= MODALE RESTAURANT ======================= */}
      <Modal
        open={!!selectedGroup}
        onClose={() => {
          setSelectedGroupId(null);
          setSelectedConfigId(null);
        }}
        size="lg"
        title={selectedConfig ? selectedConfig.name : selectedGroup?.name}
        subtitle={selectedConfig ? selectedGroup?.name : undefined}
        leading={
          selectedConfig ? (
            <IconButton label="Retour aux configurations" variant="secondary" onClick={() => setSelectedConfigId(null)}>
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
          ) : (
            selectedGroup && (
              <label
                className="relative flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-line bg-cream text-muted transition hover:border-brand/50"
                title="Changer la photo"
              >
                {uploadingImage ? (
                  <Spinner className="h-5 w-5" />
                ) : selectedGroup.image_url ? (
                  <img src={selectedGroup.image_url} className="h-full w-full object-cover" alt="" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
                <input type="file" accept="image/*" disabled={uploadingImage} onChange={e => handleGroupImageChange(e, selectedGroup.id)} className="sr-only" />
              </label>
            )
          )
        }
        footer={
          !selectedConfig && isSuperAdmin && selectedGroup ? (
            <Button variant="dangerSoft" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => deleteGroup(selectedGroup)}>
              Supprimer le restaurant
            </Button>
          ) : undefined
        }
      >
        {selectedGroup && !selectedConfig && (
          <div className="space-y-4">
            {isSuperAdmin && (
              <div className="[&>label]:w-full [&_.relative]:flex-1">
                <OwnerSelect accounts={accounts} value={selectedGroup.user_id ?? null} onChange={id => setGroupOwner(selectedGroup.id, id)} />
              </div>
            )}
            {isSuperAdmin && (
              <form
                className="space-y-2 rounded-2xl border border-sand bg-cream/60 p-3"
                onSubmit={e => {
                  e.preventDefault();
                  createNewConfiguration();
                }}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={newConfigName} onChange={e => setNewConfigName(e.target.value)} placeholder="Nouvelle configuration" className="h-11" />
                  <div className="flex gap-2">
                    <Select value={newConfigFormat} onChange={e => setNewConfigFormat(e.target.value)} aria-label="Format" className="w-28 [&_select]:h-11">
                      {FORMATS.map(f => (
                        <option key={f.value} value={f.value}>
                          {f.value}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" disabled={!newConfigName.trim()} icon={<Plus className="h-5 w-5" />} className="h-11 w-11 px-0" aria-label="Créer" />
                  </div>
                </div>
              </form>
            )}

            {groupConfigs.length === 0 ? (
              <EmptyState icon={<LayoutGrid className="h-6 w-6" />} title="Aucune configuration" />
            ) : (
              <ul className="space-y-2">
                {groupConfigs.map(config => {
                  const inConfig = screens.filter(s => s.configuration_id === config.id);
                  const onlineCount = inConfig.filter(online).length;
                  const { rows, cols } = parseFormat(config.format);
                  return (
                    <li key={config.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedConfigId(config.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand/40 hover:bg-brand-50/40 active:scale-[0.99]"
                      >
                        <span
                          className="grid h-10 w-10 flex-shrink-0 gap-0.5 rounded-xl bg-brand-50 p-1.5"
                          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
                          aria-hidden
                        >
                          {Array.from({ length: rows * cols }).map((_, i) => (
                            <span key={i} className="rounded-[3px] bg-brand/70" />
                          ))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-bold text-ink">{config.name}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-ink" title="En ligne">
                          <StatusDot online={onlineCount > 0} className="h-2 w-2" />
                          {onlineCount}
                        </span>
                        <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted" />
                      </button>
                      {isSuperAdmin && (
                        <IconButton label={`Supprimer ${config.name}`} variant="danger" onClick={() => deleteConfiguration(config)}>
                          <Trash2 className="h-4.5 w-4.5" />
                        </IconButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {selectedGroup && selectedConfig && (
          <div className="space-y-4">
            <div className="flex justify-end">
              {isSuperAdmin ? (
                <Select
                  value={selectedConfig.format}
                  onChange={e => changeConfigFormat(selectedConfig, e.target.value)}
                  aria-label="Format de la grille"
                  className="w-28 [&_select]:h-10"
                >
                  {FORMATS.map(f => (
                    <option key={f.value} value={f.value}>
                      {f.value}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{selectedConfig.format}</Badge>
              )}
            </div>
            {renderConfigGrid(selectedConfig)}
          </div>
        )}
      </Modal>

      {/* ======================= MODALE ASSIGNATION ======================= */}
      <Modal
        open={!!assignTarget && isSuperAdmin}
        onClose={() => setAssignTarget(null)}
        size="sm"
        z="z-[60]"
        title={`Position ${assignTarget?.displayNum ?? ''}`}
      >
        {unassignedScreens.length === 0 ? (
          <EmptyState icon={<Hourglass className="h-6 w-6" />} title="Aucun écran disponible" />
        ) : (
          <div className="space-y-2">
            {unassignedScreens.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => submitAssign(s.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left transition hover:border-brand/40 hover:bg-brand-50/40 active:scale-[0.99]"
              >
                <StatusDot online={online(s)} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{s.id}</span>
                <Plus className="h-5 w-5 text-brand" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Choix du compte propriétaire (admin). */
function OwnerSelect({ accounts, value, onChange }: { accounts: Profile[]; value: string | null; onChange: (id: string | null) => void }) {
  const known = !value || accounts.some(a => a.id === value);
  return (
    <label className="flex min-w-0 items-center gap-2">
      <UserRound className="h-4 w-4 flex-shrink-0 text-muted" aria-hidden />
      <span className="sr-only">Compte propriétaire</span>
      <Select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="min-w-0 flex-1 sm:w-56 sm:flex-none [&_select]:h-10 [&_select]:text-sm"
      >
        <option value="">Aucun compte</option>
        {!known && value && <option value={value}>Compte inconnu</option>}
        {accounts.map(a => (
          <option key={a.id} value={a.id}>
            {a.email || a.id}
            {a.role === 'admin' ? ' (admin)' : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}
