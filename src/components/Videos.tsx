import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCopy, Copy, Film, FolderOpen, FolderPlus, Gauge, Link2, Loader2, MonitorPlay, Play, Plus, RefreshCw, Search, Trash2, Video, XCircle } from 'lucide-react';
import { sbClient } from '../lib/supabase';
import { errorMessage, must, useLibrary, useVideoAnalyses } from '../lib/data';
import { fileExtension, googleDriveThumbnail, isGoogleDrive, parsePlaylist, transformStorageUrl } from '../lib/media';
import type { Album, AppScreen, Configuration, VideoFile } from '../lib/types';
import {
  DEFAULT_TARGET,
  analyzeVideo,
  assess,
  mbps,
  megabytes,
  recommendation,
  targetsByUrl,
  type Assessment,
  type VideoAnalysis,
} from '../lib/videoAnalysis';
import { formatDuration } from '../lib/diagnostics';
import { Button, EmptyState, IconButton, Input, Modal, PageTitle, Segmented, Spinner, cn, useFeedback } from './ui';

interface VideosProps {
  isSuperAdmin: boolean;
  onPlayVideo: (fileUrl: string) => void;
  /** Écrans visibles par le compte : sert à indiquer où chaque vidéo est diffusée. */
  screens?: AppScreen[];
  /** Configurations : servent à connaître la taille des murs qui diffusent chaque vidéo. */
  configurations?: Configuration[];
}

/** Tente de capturer une image de la vidéo (échoue silencieusement si le CORS l'interdit). */
const generateThumbnail = (url: string): Promise<string> =>
  new Promise(resolve => {
    if (isGoogleDrive(url)) return resolve(googleDriveThumbnail(url));

    const video = document.createElement('video');
    const done = (value: string) => {
      clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timeout = setTimeout(() => done(''), 4000);

    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done('');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        done('');
      }
    };
    video.onerror = () => done('');
    video.src = url;
  });

export default function Videos({ isSuperAdmin, onPlayVideo, screens = [], configurations = [] }: VideosProps) {
  const { toast, confirm } = useFeedback();
  const { albums, videos, loading, refresh } = useLibrary();

  const [albumSearchQuery, setAlbumSearchQuery] = useState('');
  const [libView, setLibView] = useState<'albums' | 'all' | 'check'>('albums');
  const [inspectId, setInspectId] = useState<string | null>(null);

  // Contrôle qualité : analyse légère de l'en-tête de chaque vidéo (mise en cache).
  const analyses = useVideoAnalyses(useMemo(() => videos.map(v => v.url), [videos]));
  const targets = useMemo(() => targetsByUrl(screens, configurations), [screens, configurations]);
  const assessmentOf = (url: string): Assessment | undefined => {
    const a = analyses.results[url];
    return a ? assess(a, targets.get(url) || DEFAULT_TARGET) : undefined;
  };
  const qualityOf = (url: string) => (analyses.pending.has(url) ? 'pending' : assessmentOf(url)?.verdict);
  const toOptimize = videos.filter(v => {
    const q = qualityOf(v.url);
    return q === 'heavy' || q === 'incompatible' || q === 'unknown';
  });

  /** url → écrans qui diffusent cette vidéo. */
  const usage = useMemo(() => {
    const map = new Map<string, string[]>();
    screens.forEach(s =>
      parsePlaylist(s.video_url).forEach(url => {
        const list = map.get(url) || [];
        if (!list.includes(s.id)) list.push(s.id);
        map.set(url, list);
      }),
    );
    return map;
  }, [screens]);
  const albumName = (albumId: string) => albums.find(a => a.id === albumId)?.name;
  // On mémorise l'id (et non l'objet) : plus de boucle de rechargement à l'ouverture d'un dossier.
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [addVideoAlbumId, setAddVideoAlbumId] = useState<string | null>(null);
  const [newVideoName, setNewVideoName] = useState('');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const activeAlbum = albums.find(a => a.id === activeAlbumId) || null;
  const videosOf = (albumId: string) => videos.filter(v => v.album_id === albumId);
  const filteredAlbums = albums.filter(a => a.name.toLowerCase().includes(albumSearchQuery.toLowerCase()));

  /* ------------------------------ Actions ------------------------------ */

  const handleCreateAlbum = async () => {
    const name = newAlbumName.trim();
    if (!isSuperAdmin || !name) return;
    setBusy(true);
    try {
      must(await sbClient.from('albums').insert([{ name }]));
      toast('Dossier créé');
      setNewAlbumName('');
      setShowCreateAlbum(false);
      await refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAlbum = async (album: Album) => {
    if (!isSuperAdmin) return;
    const count = videosOf(album.id).length;
    const ok = await confirm({
      title: `Supprimer « ${album.name} » ?`,
      message: count > 0 ? `${count} vidéo${count > 1 ? 's' : ''}` : undefined,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      must(await sbClient.from('albums').delete().eq('id', album.id));
      toast('Dossier supprimé');
      if (activeAlbumId === album.id) setActiveAlbumId(null);
      await refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const closeAddVideo = () => {
    setAddVideoAlbumId(null);
    setNewVideoName('');
    setNewVideoUrl('');
  };

  const handleAddVideoLink = async () => {
    if (!isSuperAdmin || !addVideoAlbumId) return;
    const name = newVideoName.trim();
    const rawUrl = newVideoUrl.trim();
    if (!name || !rawUrl) return;

    setBusy(true);
    try {
      const url = transformStorageUrl(rawUrl);
      const thumbnail = await generateThumbnail(url);
      const base = { album_id: addVideoAlbumId, name, url, size: 'Lien cloud' };

      const { error } = await sbClient.from('videos').insert([{ ...base, thumbnail: thumbnail || null }]);
      if (error) {
        // Compatibilité : base sans colonne "thumbnail".
        if (error.message.includes('thumbnail')) must(await sbClient.from('videos').insert([base]));
        else throw error;
      }
      toast('Vidéo ajoutée');
      closeAddVideo();
      await refresh();
    } catch (err) {
      toast(`Erreur d'enregistrement : ${errorMessage(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVideo = async (video: VideoFile) => {
    if (!isSuperAdmin) return;
    const ok = await confirm({ title: `Retirer « ${video.name} » ?`, confirmLabel: 'Retirer', danger: true });
    if (!ok) return;
    try {
      must(await sbClient.from('videos').delete().eq('id', video.id));
      toast('Vidéo retirée');
      await refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const copyVideoLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié');
    } catch {
      toast('Impossible de copier le lien', 'error');
    }
  };

  /* ------------------------------ Rendu ------------------------------ */

  return (
    <div className="space-y-5">
      <PageTitle
        title="Vidéos"
        actions={
          isSuperAdmin && (
            <IconButton label="Nouveau dossier" variant="secondary" onClick={() => setShowCreateAlbum(true)}>
              <FolderPlus className="h-5 w-5" />
            </IconButton>
          )
        }
      />

      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <Segmented
          value={libView}
          onChange={setLibView}
          options={[
            { value: 'albums', label: 'Dossiers' },
            { value: 'all', label: 'Toutes' },
            { value: 'check', label: toOptimize.length ? `À optimiser · ${toOptimize.length}` : 'À optimiser' },
          ]}
        />
      </div>

      <Input
        value={albumSearchQuery}
        onChange={e => setAlbumSearchQuery(e.target.value)}
        placeholder="Rechercher"
        leading={<Search className="h-4.5 w-4.5" />}
        aria-label="Rechercher"
      />

      {libView === 'all' || libView === 'check' ? (
        loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          (() => {
            const q = albumSearchQuery.trim().toLowerCase();
            const base = libView === 'check' ? toOptimize : videos;
            const list = base.filter(v => !q || v.name.toLowerCase().includes(q) || (albumName(v.album_id) || '').toLowerCase().includes(q));
            if (list.length === 0) {
              return libView === 'check' && !q ? (
                <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Toutes les vidéos sont légères" />
              ) : (
                <EmptyState icon={<Film className="h-6 w-6" />} title={q ? 'Aucun résultat' : 'Aucune vidéo'} />
              );
            }
            return (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {list.map(v => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    albumLabel={albumName(v.album_id) || 'Sans dossier'}
                    usedOn={usage.get(v.url) || []}
                    quality={qualityOf(v.url)}
                    onInspect={() => setInspectId(v.id)}
                    canDelete={isSuperAdmin}
                    onPlay={() => onPlayVideo(v.url)}
                    onCopy={() => copyVideoLink(v.url)}
                    onDelete={() => handleDeleteVideo(v)}
                  />
                ))}
              </div>
            );
          })()
        )
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : albums.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-6 w-6" />}
          title="Aucun dossier"
        />
      ) : filteredAlbums.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Aucun résultat" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredAlbums.map(album => {
            const list = videosOf(album.id);
            return (
              <div key={album.id} className="card group flex items-center gap-2 p-3 pr-2 transition hover:border-brand/40 hover:shadow-lift">
                <button type="button" onClick={() => setActiveAlbumId(album.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <AlbumCover videos={list} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold uppercase tracking-wide text-ink transition group-hover:text-brand-800">{album.name}</span>
                  </span>
                  <span className="text-sm font-bold tabular-nums text-muted">{list.length}</span>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted transition group-hover:translate-x-0.5" />
                </button>
                {isSuperAdmin && (
                  <IconButton label={`Supprimer ${album.name}`} variant="danger" onClick={() => handleDeleteAlbum(album)}>
                    <Trash2 className="h-4.5 w-4.5" />
                  </IconButton>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ======================= VUE DOSSIER (plein écran) ======================= */}
      {activeAlbum && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-cream animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="sticky top-0 z-10 border-b border-line bg-cream/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
            <div className="mx-auto flex max-w-4xl items-center gap-3">
              <IconButton label="Retour" variant="secondary" onClick={() => setActiveAlbumId(null)}>
                <ChevronLeft className="h-5 w-5" />
              </IconButton>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-extrabold uppercase tracking-wide text-ink">{activeAlbum.name}</h2>
              </div>
              {isSuperAdmin && (
                <IconButton label="Ajouter une vidéo" variant="secondary" onClick={() => setAddVideoAlbumId(activeAlbum.id)}>
                  <Plus className="h-5 w-5" />
                </IconButton>
              )}
            </div>
          </div>

          <div className="mx-auto max-w-4xl px-4 pb-40 pt-5">
            {videosOf(activeAlbum.id).length === 0 ? (
              <EmptyState
                icon={<Video className="h-6 w-6" />}
                title="Dossier vide"
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {videosOf(activeAlbum.id).map(v => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    usedOn={usage.get(v.url) || []}
                    quality={qualityOf(v.url)}
                    onInspect={() => setInspectId(v.id)}
                    canDelete={isSuperAdmin}
                    onPlay={() => onPlayVideo(v.url)}
                    onCopy={() => copyVideoLink(v.url)}
                    onDelete={() => handleDeleteVideo(v)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= CONTRÔLE QUALITÉ ======================= */}
      {(() => {
        const v = videos.find(x => x.id === inspectId);
        const a = v ? analyses.results[v.url] : undefined;
        const target = v ? targets.get(v.url) || DEFAULT_TARGET : DEFAULT_TARGET;
        return (
          <Modal
            open={!!v}
            onClose={() => setInspectId(null)}
            title={v?.name}
            subtitle={v ? albumName(v.album_id) : undefined}
            z="z-[60]"
            footer={
              v && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={analyses.pending.has(v.url)} onClick={() => analyses.reanalyze(v.url)}>
                    Réanalyser
                  </Button>
                  {a?.ok && (
                    <Button
                      size="sm"
                      className="ml-auto"
                      icon={<ClipboardCopy className="h-4 w-4" />}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(recommendation(a, target).ffmpeg);
                          toast('Commande ffmpeg copiée');
                        } catch {
                          toast('Copie impossible', 'error');
                        }
                      }}
                    >
                      Commande ffmpeg
                    </Button>
                  )}
                </div>
              )
            }
          >
            {v && <QualitySheet analysis={a} pending={analyses.pending.has(v.url)} target={target} walls={targets.get(v.url)?.walls || []} />}
          </Modal>
        );
      })()}

      {/* ======================= MODALES ======================= */}
      <Modal
        open={showCreateAlbum && isSuperAdmin}
        onClose={() => {
          setShowCreateAlbum(false);
          setNewAlbumName('');
        }}
        size="sm"
        title="Nouveau dossier"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              block
              onClick={() => {
                setShowCreateAlbum(false);
                setNewAlbumName('');
              }}
            >
              Annuler
            </Button>
            <Button block loading={busy} disabled={!newAlbumName.trim()} onClick={handleCreateAlbum}>
              Créer
            </Button>
          </div>
        }
      >
        <form
          onSubmit={e => {
            e.preventDefault();
            handleCreateAlbum();
          }}
        >
          <div>
            <Input id="album-name" value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)} placeholder="Nom" aria-label="Nom" autoFocus />
          </div>
        </form>
      </Modal>

      <Modal
        open={!!addVideoAlbumId && isSuperAdmin}
        onClose={closeAddVideo}
        z="z-[60]"
        title="Nouvelle vidéo"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={closeAddVideo}>
              Annuler
            </Button>
            <Button block loading={busy} disabled={!newVideoName.trim() || !newVideoUrl.trim()} onClick={handleAddVideoLink}>
              {busy ? 'Ajout…' : 'Ajouter'}
            </Button>
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            handleAddVideoLink();
          }}
        >
          <div>
            <Input id="video-name" value={newVideoName} onChange={e => setNewVideoName(e.target.value)} placeholder="Nom" aria-label="Nom" autoFocus />
          </div>
          <div>
            <Input
              id="video-url"
              type="url"
              inputMode="url"
              value={newVideoUrl}
              onChange={e => setNewVideoUrl(e.target.value)}
              placeholder="Lien Dropbox, Drive, mp4"
              aria-label="Lien"
              leading={<Link2 className="h-4.5 w-4.5" />}
            />
          </div>
          <DraftQuality url={newVideoUrl} />
          <button type="submit" className="sr-only">
            Ajouter
          </button>
        </form>
      </Modal>
    </div>
  );
}

/* ================================ Sous-composants ================================ */

function VideoCard({
  video,
  albumLabel,
  usedOn,
  quality,
  onInspect,
  canDelete,
  onPlay,
  onCopy,
  onDelete,
}: {
  video: VideoFile;
  albumLabel?: string;
  usedOn: string[];
  quality?: Assessment['verdict'] | 'pending';
  onInspect: () => void;
  canDelete: boolean;
  onPlay: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card group overflow-hidden p-2">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
        <VideoThumb video={video} />
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Lire ${video.name}`}
          className="absolute inset-0 flex items-center justify-center bg-black/10 transition hover:bg-black/25"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-lg transition group-hover:scale-110">
            <Play className="ml-0.5 h-4 w-4 fill-brand text-brand" />
          </span>
        </button>
        {usedOn.length > 0 && (
          <span
            className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white backdrop-blur"
            title={`Diffusée sur : ${usedOn.join(', ')}`}
          >
            <MonitorPlay className="h-3.5 w-3.5" />
            {usedOn.length}
          </span>
        )}
        <button
          type="button"
          onClick={onInspect}
          aria-label="Contrôle qualité"
          title="Contrôle qualité"
          className={cn(
            'absolute bottom-1.5 left-1.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold backdrop-blur transition hover:brightness-110',
            quality === 'light' && 'bg-black/45 text-emerald-300',
            quality === 'heavy' && 'bg-amber-500/95 text-white',
            (quality === 'incompatible' || quality === 'unknown') && 'bg-red-600/95 text-white',
            (!quality || quality === 'pending') && 'bg-black/45 text-white/80',
          )}
        >
          {quality === 'light' && <CheckCircle2 className="h-4 w-4" />}
          {quality === 'heavy' && <AlertTriangle className="h-4 w-4" />}
          {(quality === 'incompatible' || quality === 'unknown') && <XCircle className="h-4 w-4" />}
          {(!quality || quality === 'pending') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {quality === 'heavy' && 'À optimiser'}
          {quality === 'incompatible' && 'Incompatible'}
          {quality === 'unknown' && 'Illisible'}
        </button>
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          <IconButton label="Copier le lien" size="sm" variant="onDark" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          {canDelete && (
            <IconButton label={`Retirer ${video.name}`} size="sm" variant="onDark" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>
      <div className="min-w-0 px-1 pt-2">
        <p className="truncate text-sm font-bold text-ink" title={video.name}>
          {video.name}
        </p>
        {albumLabel && <p className="truncate text-xs text-muted">{albumLabel}</p>}
      </div>
    </div>
  );
}

function VideoThumb({ video, className }: { video: VideoFile; className?: string }) {
  const [failed, setFailed] = useState(false);
  const cls = cn('h-full w-full object-cover', className);

  if (video.thumbnail && !failed) return <img src={video.thumbnail} alt="" loading="lazy" className={cls} onError={() => setFailed(true)} />;
  if (video.url && !isGoogleDrive(video.url) && !failed) {
    // #t= affiche une image de la vidéo ; preload="metadata" évite de télécharger tout le fichier.
    return <video src={`${video.url}#t=0.5`} muted playsInline preload="metadata" className={cn(cls, 'pointer-events-none')} onError={() => setFailed(true)} />;
  }
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand-100 to-cream text-brand">
      <Video className="h-6 w-6" />
      <span className="rounded bg-white/80 px-1.5 text-[10px] font-black tracking-wide text-brand-800">{fileExtension(video.name)}</span>
    </span>
  );
}

function AlbumCover({ videos }: { videos: VideoFile[] }) {
  const cover = videos.find(v => v.thumbnail) || videos[0];
  return (
    <span className="relative block h-14 w-20 flex-shrink-0">
      {videos.length > 1 && <span className="absolute inset-0 translate-x-1.5 translate-y-1 rotate-3 rounded-xl border border-sand bg-brand-800/15" />}
      {videos.length > 0 && <span className="absolute inset-0 -rotate-2 rounded-xl border border-sand bg-brand/10" />}
      <span className="absolute inset-0 overflow-hidden rounded-xl border border-line bg-cream shadow-sm">
        {cover ? (
          <VideoThumb video={cover} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-brand/40">
            <FolderOpen className="h-6 w-6" />
          </span>
        )}
      </span>
    </span>
  );
}

const VERDICT_UI = {
  light: { tone: 'bg-emerald-50 text-emerald-700', icon: <CheckCircle2 className="h-5 w-5" />, label: 'Légère pour les écrans' },
  heavy: { tone: 'bg-amber-50 text-amber-700', icon: <AlertTriangle className="h-5 w-5" />, label: 'À optimiser' },
  incompatible: { tone: 'bg-red-50 text-red-700', icon: <XCircle className="h-5 w-5" />, label: 'Incompatible' },
  unknown: { tone: 'bg-red-50 text-red-700', icon: <XCircle className="h-5 w-5" />, label: 'Illisible' },
} as const;

function QualitySheet({
  analysis: a,
  pending,
  target,
  walls,
}: {
  analysis?: VideoAnalysis;
  pending: boolean;
  target: { width: number; height: number };
  walls: string[];
}) {
  if (!a || pending) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
        Analyse de l’en-tête…
      </div>
    );
  }
  const s = assess(a, target);
  const ui = VERDICT_UI[s.verdict];
  const reco = a.ok ? recommendation(a, target) : null;
  const rows: [string, string][] = a.ok
    ? [
        ['Résolution', a.width && a.height ? `${a.width}×${a.height}` : '—'],
        ['Images/s', a.fps ? `${Math.round(a.fps * 10) / 10}` : '—'],
        ['Codec', `${(a.codec || '—').toUpperCase()}${a.profile ? ` · ${a.profile}` : ''}`],
        ['Débit', a.bitrate ? mbps(a.bitrate) : '—'],
        ['Durée', a.duration ? formatDuration(a.duration) : '—'],
        ['Taille', a.size ? megabytes(a.size) : '—'],
        ['Son', a.hasAudio ? 'Oui' : 'Non'],
        ['Utile', `${target.width}×${target.height}`],
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-3 rounded-2xl p-3.5', ui.tone)}>
        {ui.icon}
        <div className="min-w-0">
          <p className="font-bold">{ui.label}</p>
          {s.reasons.map(r => (
            <p key={r} className="text-sm opacity-90">
              {r}
            </p>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-cream/70 px-3.5 py-2.5">
              <dt className="text-xs font-semibold text-muted">{k}</dt>
              <dd className="truncate text-[15px] font-bold tabular-nums text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {walls.length > 0 && (
        <p className="flex items-start gap-2 px-1 text-sm text-muted">
          <MonitorPlay className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" />
          {walls.join(', ')}
        </p>
      )}

      {reco && s.verdict !== 'light' && (
        <div className="rounded-2xl border border-line p-3.5">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <Gauge className="h-4 w-4 text-brand" /> Export conseillé
          </p>
          <p className="mt-1 text-sm text-muted">{reco.summary}</p>
        </div>
      )}
    </div>
  );
}

/** Analyse du lien pendant la saisie, avant même d'ajouter la vidéo. */
function DraftQuality({ url }: { url: string }) {
  const [state, setState] = useState<{ url: string; analysis?: VideoAnalysis } | null>(null);

  useEffect(() => {
    const clean = url.trim();
    if (!/^https?:\/\//.test(clean)) {
      setState(null);
      return;
    }
    const direct = transformStorageUrl(clean);
    setState({ url: direct });
    let cancelled = false;
    const t = setTimeout(async () => {
      const analysis = await analyzeVideo(direct);
      if (!cancelled) setState({ url: direct, analysis });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [url]);

  if (!state) return null;
  if (!state.analysis) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Contrôle de la vidéo…
      </p>
    );
  }
  const s = assess(state.analysis, DEFAULT_TARGET);
  const ui = VERDICT_UI[s.verdict];
  const a = state.analysis;
  return (
    <div className={cn('rounded-2xl p-3 text-sm', ui.tone)}>
      <p className="flex items-center gap-2 font-bold">
        {ui.icon}
        {ui.label}
      </p>
      {a.ok && (
        <p className="mt-0.5 opacity-90">
          {a.width}×{a.height} · {a.fps ? `${Math.round(a.fps)} i/s` : '? i/s'} · {(a.codec || '').toUpperCase()}
          {a.bitrate ? ` · ${mbps(a.bitrate)}` : ''}
        </p>
      )}
      {s.reasons.map(r => (
        <p key={r} className="opacity-90">
          {r}
        </p>
      ))}
    </div>
  );
}
