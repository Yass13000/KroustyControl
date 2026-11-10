import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Film,
  FolderOpen,
  Library,
  Link2,
  MonitorPlay,
  Monitor,
  Moon,
  Music2,
  Plus,
  Rocket,
  Search,
  Sun,
  Trash2,
  ChevronLeft,
} from 'lucide-react';
import { sbClient } from '../lib/supabase';
import Schedules from './Schedules';
import { errorMessage, mustAll, useLibrary } from '../lib/data';
import { FORMATS, isOnline, parseFormat, parsePlaylist, transformStorageUrl } from '../lib/media';
import type { AppScreen, Configuration, Group, GroupMode } from '../lib/types';
import { Badge, Button, EmptyState, IconButton, Input, Modal, PageTitle, Segmented, Spinner, StatusDot, Switch, cn, useFeedback } from './ui';

interface BroadcastProps {
  groups: Group[];
  configurations: Configuration[];
  screens: AppScreen[];
  isSuperAdmin: boolean;
  loading: boolean;
  onSaved: () => void;
  attributionInputs: Record<string, string>;
  setAttributionInputs: Dispatch<SetStateAction<Record<string, string>>>;
  groupModes: Record<string, GroupMode>;
  setGroupModes: Dispatch<SetStateAction<Record<string, GroupMode>>>;
}

type EditKey = 'schedule' | 'audio' | 'video';

const audioKeyOf = (configId: string) => `${configId}-restaurant-audio`;
const globalVideoKeyOf = (configId: string) => `${configId}-global-video`;
const screenVideoKeyOf = (screenId: string) => `${screenId}-video`;
const hhmm = (t: string | null | undefined, fallback: string) => (t ? t.slice(0, 5) : fallback);

export default function Broadcast({
  groups,
  configurations,
  screens,
  isSuperAdmin,
  loading,
  onSaved,
  attributionInputs,
  setAttributionInputs,
  groupModes,
  setGroupModes,
}: BroadcastProps) {
  const { toast } = useFeedback();
  const library = useLibrary();

  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { open: string; close: string }>>({});
  const [selectedConfigs, setSelectedConfigs] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [formatFilter, setFormatFilter] = useState('');
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [activeEdits, setActiveEdits] = useState<Record<EditKey, boolean>>({ schedule: false, audio: false, video: false });
  const [videoModes, setVideoModes] = useState<Record<string, 'library' | 'manual'>>({});
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [videoPickerTarget, setVideoPickerTarget] = useState<string | null>(null);
  const [openedAlbumId, setOpenedAlbumId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  // Pré-remplit les champs avec les valeurs actuelles (sans écraser une saisie en cours).
  useEffect(() => {
    setScheduleInputs(prev => {
      let changed = false;
      const next = { ...prev };
      configurations.forEach(c => {
        if (!next[c.id]) {
          const g = groupById.get(c.group_id);
          next[c.id] = { open: hhmm(g?.open_time, '08:00'), close: hhmm(g?.close_time, '22:00') };
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setAttributionInputs(prev => {
      let changed = false;
      const next = { ...prev };
      const fill = (key: string, value: string | null | undefined) => {
        if (next[key] === undefined) {
          next[key] = value || '';
          changed = true;
        }
      };
      configurations.forEach(c => {
        const inConfig = screens.filter(s => s.configuration_id === c.id);
        if (inConfig.length === 0) return;
        const master = inConfig.find(s => s.pos_x === 0 && s.pos_y === 0);
        fill(audioKeyOf(c.id), master?.audio_url);
        fill(globalVideoKeyOf(c.id), inConfig[0]?.video_url);
        inConfig.forEach(s => fill(screenVideoKeyOf(s.id), s.video_url));
      });
      return changed ? next : prev;
    });
  }, [configurations, screens, groupById, setAttributionInputs]);

  // Client avec une seule configuration : pré-sélection automatique.
  useEffect(() => {
    if (!isSuperAdmin && configurations.length === 1) {
      setSelectedConfigs(prev => (Object.keys(prev).length === 0 ? { [configurations[0].id]: true } : prev));
    }
  }, [isSuperAdmin, configurations]);

  /* ------------------------------ Sélection ------------------------------ */

  const matchesSearch = (c: Configuration) =>
    !restaurantSearch || (groupById.get(c.group_id)?.name || '').toLowerCase().includes(restaurantSearch.toLowerCase());

  const filteredConfigs = configurations.filter(c => (!formatFilter || c.format === formatFilter) && matchesSearch(c));
  const targetConfigIds = Object.keys(selectedConfigs).filter(id => selectedConfigs[id]);
  const selectedCount = targetConfigIds.length;

  const allSelected = filteredConfigs.length > 0 && filteredConfigs.every(c => selectedConfigs[c.id]);

  const selectAllFiltered = () => {
    const next: Record<string, boolean> = {};
    filteredConfigs.forEach(c => (next[c.id] = true));
    setSelectedConfigs(next);
  };

  const toggleConfig = (id: string) => setSelectedConfigs(prev => ({ ...prev, [id]: !prev[id] }));

  /* ------------------------------ Saisies ------------------------------ */

  const setEdit = (key: EditKey, value: boolean) => setActiveEdits(prev => ({ ...prev, [key]: value }));

  const updateAttribution = (key: string, value: string) => {
    setAttributionInputs(prev => ({ ...prev, [key]: value }));
    if (key.includes('video')) setEdit('video', true);
    else if (key.includes('audio')) setEdit('audio', true);
  };

  const updateSchedule = (configId: string, type: 'open' | 'close', value: string) => {
    setScheduleInputs(prev => ({ ...prev, [configId]: { ...prev[configId], [type]: value } }));
    setEdit('schedule', true);
  };

  const changeConfigMode = (configId: string, value: GroupMode) => {
    setGroupModes(prev => ({ ...prev, [configId]: value }));
    setEdit('video', true);
  };

  /* ------------------------------ Playlist ------------------------------ */

  const videoNameByUrl = (url: string) => library.videos.find(v => v.url === url.trim())?.name || 'Vidéo externe';
  const getPlaylist = (key: string) => parsePlaylist(attributionInputs[key]);
  const setPlaylist = (key: string, list: string[]) => updateAttribution(key, list.join(','));

  const addToPlaylist = (key: string, url: string) => {
    const clean = url.trim();
    if (clean) setPlaylist(key, [...getPlaylist(key), clean]);
  };
  const removeFromPlaylist = (key: string, index: number) => setPlaylist(key, getPlaylist(key).filter((_, i) => i !== index));
  const moveInPlaylist = (key: string, index: number, dir: -1 | 1) => {
    const list = getPlaylist(key);
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setPlaylist(key, list);
  };

  /* ------------------------------ Déploiement ------------------------------ */

  const hasEdits = activeEdits.schedule || activeEdits.audio || activeEdits.video;

  const applyConfig = async () => {
    if (isSaving || selectedCount === 0 || !hasEdits) return;
    setIsSaving(true);
    try {
      const queries: PromiseLike<{ error: unknown }>[] = [];
      const sourceConfigId = targetConfigIds[0];

      if (activeEdits.schedule) {
        const schedule = scheduleInputs[sourceConfigId] || { open: '08:00', close: '22:00' };
        const groupIds = Array.from(
          new Set(targetConfigIds.map(cid => configurations.find(c => c.id === cid)?.group_id).filter((g): g is string => !!g)),
        );
        if (groupIds.length > 0) {
          queries.push(sbClient.from('groups').update({ open_time: schedule.open, close_time: schedule.close }).in('id', groupIds));
          // Le lecteur des TV lit les horaires sur l'écran lui-même : on les applique à tous les écrans de ces restaurants.
          const configIdsOfGroups = configurations.filter(c => groupIds.includes(c.group_id)).map(c => c.id);
          if (configIdsOfGroups.length > 0) {
            queries.push(
              sbClient
                .from('screens_config')
                .update({ opening_time: schedule.open.slice(0, 5), closing_time: schedule.close.slice(0, 5) })
                .in('configuration_id', configIdsOfGroups),
            );
          }
        }
      }

      if (activeEdits.video || activeEdits.audio) {
        const restaurantAudioUrl = transformStorageUrl((attributionInputs[audioKeyOf(sourceConfigId)] || '').trim());
        const globalVideoUrl = transformStorageUrl((attributionInputs[globalVideoKeyOf(sourceConfigId)] || '').trim());

        for (const configId of targetConfigIds) {
          const config = configurations.find(c => c.id === configId);
          if (!config) continue;

          const mode = groupModes[config.id] || 'global';
          const inConfig = screens.filter(s => s.configuration_id === config.id);
          const { rows, cols } = parseFormat(config.format);

          if (selectedCount === 1 && mode === 'per-screen') {
            inConfig.forEach(s => {
              const isMaster = s.pos_x === 0 && s.pos_y === 0;
              const payload: Record<string, unknown> = { total_cols: cols, total_rows: rows, pos_x: s.pos_x, pos_y: s.pos_y };
              if (activeEdits.video) payload.video_url = transformStorageUrl((attributionInputs[screenVideoKeyOf(s.id)] || '').trim());
              if (activeEdits.audio) payload.audio_url = isMaster ? restaurantAudioUrl : '';
              queries.push(sbClient.from('screens_config').update(payload).eq('id', s.id));
            });
          } else {
            const masterIds = inConfig.filter(s => s.pos_x === 0 && s.pos_y === 0).map(s => s.id);
            const slaveIds = inConfig.filter(s => !(s.pos_x === 0 && s.pos_y === 0)).map(s => s.id);

            if (masterIds.length > 0) {
              const payload: Record<string, unknown> = { total_cols: cols, total_rows: rows, pos_x: 0, pos_y: 0 };
              if (activeEdits.video) payload.video_url = globalVideoUrl;
              if (activeEdits.audio) payload.audio_url = restaurantAudioUrl;
              queries.push(sbClient.from('screens_config').update(payload).in('id', masterIds));
            }
            if (slaveIds.length > 0) {
              const payload: Record<string, unknown> = { total_cols: cols, total_rows: rows };
              if (activeEdits.video) payload.video_url = globalVideoUrl;
              if (activeEdits.audio) payload.audio_url = '';
              queries.push(sbClient.from('screens_config').update(payload).in('id', slaveIds));
            }
          }
        }
      }

      await mustAll(queries);

      // Mémorise la playlist « normale » de chaque mur (rétablie hors créneaux programmés).
      // Sans incidence si la migration des programmations n'est pas encore passée.
      if (activeEdits.video) {
        const globalIds = targetConfigIds.filter(id => selectedCount > 1 || (groupModes[id] || 'global') === 'global');
        if (globalIds.length > 0) {
          await sbClient
            .from('configurations')
            .update({ default_video_url: transformStorageUrl((attributionInputs[globalVideoKeyOf(targetConfigIds[0])] || '').trim()) })
            .in('id', globalIds);
        }
      }

      toast('Déployé');
      onSaved();
    } catch (err) {
      console.error(err);
      toast(`Échec du déploiement : ${errorMessage(err)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  /* ------------------------------ Rendus ------------------------------ */

  const renderPlaylist = (key: string, label: string) => {
    const playlist = getPlaylist(key);
    const mode = videoModes[key] || 'library';
    const manual = manualInputs[key] || '';

    return (
      <div className="space-y-3 rounded-2xl border border-line bg-white p-3">
        {label && (
          <p className="flex items-center gap-1.5 px-1 text-sm font-bold text-ink">
            <MonitorPlay className="h-4 w-4 text-brand" />
            {label}
          </p>
        )}

        {playlist.length > 0 ? (
          <ol className="max-h-64 space-y-1.5 overflow-y-auto">
            {playlist.map((url, idx) => (
              <li key={`${url}-${idx}`} className="flex items-center gap-2 rounded-xl border border-sand bg-cream/70 py-1.5 pl-2 pr-1">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-black text-white">{idx + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={url}>
                  {videoNameByUrl(url)}
                </span>
                <IconButton label="Monter" size="sm" disabled={idx === 0} onClick={() => moveInPlaylist(key, idx, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </IconButton>
                <IconButton label="Descendre" size="sm" disabled={idx === playlist.length - 1} onClick={() => moveInPlaylist(key, idx, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </IconButton>
                <IconButton label="Retirer de la séquence" size="sm" variant="danger" onClick={() => removeFromPlaylist(key, idx)}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed border-line bg-cream/50 px-4 py-3 text-center text-sm text-muted">Aucune vidéo</p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Segmented
            size="sm"
            value={mode}
            onChange={v => setVideoModes(prev => ({ ...prev, [key]: v }))}
            options={[
              { value: 'library', label: '', title: 'Bibliothèque', icon: <Library className="h-4 w-4" /> },
              { value: 'manual', label: '', title: 'Lien', icon: <Link2 className="h-4 w-4" /> },
            ]}
          />
          {mode === 'manual' ? (
            <form
              className="flex flex-1 gap-2"
              onSubmit={e => {
                e.preventDefault();
                addToPlaylist(key, manual);
                setManualInputs(prev => ({ ...prev, [key]: '' }));
              }}
            >
              <Input
                value={manual}
                disabled={isSaving}
                onChange={e => setManualInputs(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder="Lien de la vidéo"
                className="h-11"
              />
              <Button type="submit" disabled={!manual.trim() || isSaving} icon={<Plus className="h-5 w-5" />} className="h-11 w-11 px-0" aria-label="Ajouter" />
            </form>
          ) : (
            <Button
              variant="soft"
              className="flex-1"
              disabled={isSaving}
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setVideoPickerTarget(key);
                setOpenedAlbumId(null);
              }}
            >
              Ajouter
            </Button>
          )}
        </div>
      </div>
    );
  };

  const scheduleSection = (configId: string, title: string) => (
    <EditSection
      icon={<Clock className="h-4.5 w-4.5" />}
      title={title}
      enabled={activeEdits.schedule}
      onToggle={v => setEdit('schedule', v)}
    >
      <div className="grid grid-cols-2 gap-3">
        <TimeField
          label="Allumage"
          icon={<Sun className="h-4 w-4 text-amber-500" />}
          value={scheduleInputs[configId]?.open || '08:00'}
          disabled={isSaving}
          onChange={v => updateSchedule(configId, 'open', v)}
        />
        <TimeField
          label="Extinction"
          icon={<Moon className="h-4 w-4 text-indigo-400" />}
          value={scheduleInputs[configId]?.close || '22:00'}
          disabled={isSaving}
          onChange={v => updateSchedule(configId, 'close', v)}
        />
      </div>
    </EditSection>
  );

  const audioSection = (configId: string, title: string) => (
    <EditSection
      icon={<Music2 className="h-4.5 w-4.5" />}
      title={title}
      enabled={activeEdits.audio}
      onToggle={v => setEdit('audio', v)}
    >
      <Input
        value={attributionInputs[audioKeyOf(configId)] || ''}
        disabled={isSaving}
        onChange={e => updateAttribution(audioKeyOf(configId), e.target.value)}
        placeholder="Lien du flux"
      />
    </EditSection>
  );

  let workspace: ReactNode = null;

  if (selectedCount === 1) {
    const config = configurations.find(c => c.id === targetConfigIds[0]);
    if (config) {
      const group = groupById.get(config.group_id);
      const { rows, cols } = parseFormat(config.format);
      const inConfig = screens.filter(s => s.configuration_id === config.id);
      const mode = groupModes[config.id] || 'global';

      const slots: ReactNode[] = [];
      const perScreen: ReactNode[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const s = inConfig.find(scr => scr.pos_x === x && scr.pos_y === y);
          slots.push(
            <div
              key={`slot-${y}-${x}`}
              className={cn(
                'flex h-20 flex-col items-center justify-center rounded-2xl border p-2 text-center',
                s ? 'border-brand/25 bg-brand-50' : 'border-dashed border-line bg-cream/60',
              )}
            >
              {s ? (
                <span className="flex max-w-full items-center gap-1.5 text-sm font-extrabold text-brand-800">
                  <StatusDot online={isOnline(s.last_ping)} sleeping={s.power_state === 'sleep'} className="h-2 w-2" />
                  <span className="truncate">{s.id}</span>
                </span>
              ) : (
                <span className="text-sm font-bold text-muted/40">—</span>
              )}
            </div>,
          );
          if (s) {
            perScreen.push(<div key={s.id}>{renderPlaylist(screenVideoKeyOf(s.id), s.id)}</div>);
          }
        }
      }

      workspace = (
        <section className="card space-y-5 p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sand pb-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-muted">{group?.name}</p>
              <h2 className="truncate text-xl font-extrabold text-ink">{config.name}</h2>
            </div>
            <Badge tone="neutral">{config.format}</Badge>
          </div>

          <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {slots}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {scheduleSection(config.id, 'Horaires')}
            {audioSection(config.id, 'Musique')}
          </div>

          <EditSection
            icon={<Film className="h-4.5 w-4.5" />}
            title="Vidéos"
            enabled={activeEdits.video}
            onToggle={v => setEdit('video', v)}
            extra={
              <Segmented
                size="sm"
                value={mode}
                disabled={isSaving}
                onChange={v => changeConfigMode(config.id, v)}
                options={[
                  { value: 'global', label: 'Unique' },
                  { value: 'per-screen', label: 'Séparé' },
                ]}
              />
            }
          >
            {mode === 'global' ? (
              renderPlaylist(globalVideoKeyOf(config.id), '')
            ) : perScreen.length > 0 ? (
              <div className="space-y-3">{perScreen}</div>
            ) : (
              <p className="text-sm text-muted">Aucun écran</p>
            )}
          </EditSection>

          <Schedules configId={config.id} videos={library.videos} albums={library.albums} perScreen={mode === 'per-screen'} />
        </section>
      );
    }
  } else if (selectedCount > 1) {
    const baseId = targetConfigIds[0];
    const base = configurations.find(c => c.id === baseId);
    if (base) {
      workspace = (
        <section className="card space-y-5 border-2 border-dashed border-brand/30 p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h2 className="border-b border-sand pb-4 text-xl font-extrabold text-ink">{selectedCount} configurations</h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {scheduleSection(baseId, 'Horaires')}
            {audioSection(baseId, 'Musique')}
          </div>

          <EditSection
            icon={<Film className="h-4.5 w-4.5" />}
            title="Vidéos"
            enabled={activeEdits.video}
            onToggle={v => setEdit('video', v)}
          >
            {renderPlaylist(globalVideoKeyOf(baseId), '')}
          </EditSection>
        </section>
      );
    }
  }

  /* ------------------------------ Page ------------------------------ */

  if (loading && groups.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const pickerVideos = openedAlbumId ? library.videos.filter(v => v.album_id === openedAlbumId) : [];
  const pickerAlbums = [...library.albums].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const openedAlbum = library.albums.find(a => a.id === openedAlbumId);

  return (
    <div className="space-y-5">
      <PageTitle title="Diffusion" />

      {groups.length === 0 ? (
        <EmptyState icon={<Monitor className="h-6 w-6" />} title="Aucun restaurant" />
      ) : (
        <>
          <section className="card space-y-4 p-5">
            {groups.length > 1 && (
              <div className="space-y-2.5">
                <Input
                  value={restaurantSearch}
                  onChange={e => {
                    setRestaurantSearch(e.target.value);
                    setSelectedConfigs({});
                  }}
                  placeholder="Rechercher"
                  leading={<Search className="h-4.5 w-4.5" />}
                  aria-label="Rechercher un restaurant"
                />
                <div className="flex items-center gap-2">
                  <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
                    <Segmented
                      size="sm"
                      value={formatFilter}
                      onChange={v => {
                        setFormatFilter(v);
                        setSelectedConfigs({});
                      }}
                      options={[{ value: '', label: 'Tous' }, ...FORMATS.map(f => ({ value: f.value as string, label: f.value }))]}
                    />
                  </div>
                  {filteredConfigs.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={allSelected ? () => setSelectedConfigs({}) : selectAllFiltered}>
                      {allSelected ? 'Aucun' : 'Tout'}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <>
                {filteredConfigs.length === 0 ? (
                  <p className="rounded-2xl bg-cream px-4 py-6 text-center text-sm text-muted">Aucun résultat</p>
                ) : (
                  <div className="grid max-h-[45vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 md:grid-cols-3">
                    {filteredConfigs.map(config => {
                      const checked = !!selectedConfigs[config.id];
                      const inConfig = screens.filter(s => s.configuration_id === config.id);
                      const online = inConfig.filter(s => isOnline(s.last_ping)).length;
                      return (
                        <button
                          key={config.id}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleConfig(config.id)}
                          className={cn(
                            'flex items-center gap-3 rounded-2xl border p-3 text-left transition-all active:scale-[0.98]',
                            checked ? 'border-brand bg-brand-50 ring-2 ring-brand/15' : 'border-line bg-white hover:border-brand/40',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border-2 transition-colors',
                              checked ? 'border-brand bg-brand text-white' : 'border-line bg-white',
                            )}
                          >
                            {checked && <Check className="h-4 w-4" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink">{groupById.get(config.group_id)?.name}</span>
                            <span className="block truncate text-xs text-muted">{config.name}</span>
                          </span>
                          <span className="flex flex-shrink-0 items-center gap-1.5 text-sm font-bold tabular-nums text-ink" title="En ligne">
                            <StatusDot online={online > 0} className="h-2 w-2" />
                            {online}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
            </>
          </section>

          {workspace}

          {selectedCount > 0 && hasEdits && (
            <div className="sticky bottom-28 z-30 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <Button size="lg" block onClick={applyConfig} loading={isSaving} disabled={!hasEdits} icon={<Rocket className="h-5 w-5" />} className="shadow-lift">
                Déployer
              </Button>
            </div>
          )}
        </>
      )}

      <Modal
        open={videoPickerTarget !== null}
        onClose={() => {
          setVideoPickerTarget(null);
          setOpenedAlbumId(null);
        }}
        title={openedAlbum ? openedAlbum.name : 'Bibliothèque'}
        leading={
          openedAlbum ? (
            <IconButton label="Retour aux dossiers" variant="secondary" onClick={() => setOpenedAlbumId(null)}>
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
          ) : undefined
        }
        footer={
          <Button
            block
            size="lg"
            onClick={() => {
              setVideoPickerTarget(null);
              setOpenedAlbumId(null);
            }}
          >
            OK
          </Button>
        }
      >
        {library.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !openedAlbumId ? (
          pickerAlbums.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Aucun dossier</p>
          ) : (
            <div className="space-y-2">
              {pickerAlbums.map(album => {
                const count = library.videos.filter(v => v.album_id === album.id).length;
                return (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => setOpenedAlbumId(album.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left transition hover:border-brand/40 hover:bg-brand-50/40 active:scale-[0.99]"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
                      <FolderOpen className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{album.name}</span>
                    <Badge>{count}</Badge>
                  </button>
                );
              })}
            </div>
          )
        ) : pickerVideos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Dossier vide</p>
        ) : (
          <div className="space-y-2">
            {pickerVideos.map(video => (
              <button
                key={video.id}
                type="button"
                onClick={() => {
                  if (videoPickerTarget) addToPlaylist(videoPickerTarget, video.url);
                  setJustAdded(video.id);
                  setTimeout(() => setJustAdded(cur => (cur === video.id ? null : cur)), 900);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99]',
                  justAdded === video.id ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-white hover:border-brand/40',
                )}
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cream text-brand">
                  <Film className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{video.name}</span>
                {justAdded === video.id ? (
                  <Check className="h-5 w-5 text-emerald-600" aria-label="Ajoutée" />
                ) : (
                  <Plus className="h-5 w-5 text-brand" aria-hidden />
                )}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ================================ Sous-composants ================================ */

function EditSection({
  icon,
  title,
  description,
  enabled,
  onToggle,
  extra,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-3 rounded-2xl border p-4 transition-colors', enabled ? 'border-brand/30 bg-brand-50/40' : 'border-sand bg-cream/50')}>
      <div className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', enabled ? 'bg-brand text-white' : 'bg-white text-muted')}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-ink">{title}</p>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        <Switch checked={enabled} onChange={onToggle} label={`Modifier : ${title}`} />
      </div>
      {extra && <div>{extra}</div>}
      <div className={cn('transition-opacity', !enabled && 'pointer-events-none opacity-45')} aria-disabled={!enabled}>
        {children}
      </div>
    </div>
  );
}

function TimeField({ label, icon, value, onChange, disabled }: { label: string; icon: ReactNode; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="relative block" title={label}>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{icon}</span>
      <span className="sr-only">{label}</span>
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="h-12 w-full cursor-pointer rounded-2xl border border-line bg-white pl-10 pr-3 text-base font-bold tabular-nums text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15"
      />
    </label>
  );
}
