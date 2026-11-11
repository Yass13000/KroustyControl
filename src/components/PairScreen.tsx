import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FlipVertical2, Link2, Loader2, Plus, RefreshCw, Tv, WifiOff } from 'lucide-react';
import { errorMessage, sendScreenCommand } from '../lib/data';
import { screenVersionCode } from '../lib/playerRelease';
import { isOnline, parseFormat } from '../lib/media';
import {
  cleanScreenName,
  codeOf,
  findWaitingTv,
  isValidCode,
  normalizeCode,
  pairTv,
  pruneWaitingTvs,
  recallWall,
  rememberWall,
  removeWaitingTv,
  waitForTv,
  type WaitingTv,
} from '../lib/pairing';
import type { AppScreen, Configuration, Group } from '../lib/types';
import { Button, EmptyState, Input, Modal, Select, StatusDot, Switch, cn, useFeedback } from './ui';

/**
 * Connexion d'une TV : on arrive ici en scannant le QR code affiché sur la TV (ou en tapant son code).
 * On choisit le restaurant, le mur et la position ; la TV démarre toute seule.
 */
export default function PairScreen({
  initialCode,
  groups,
  configurations,
  screens,
  waiting,
  userId,
  isSuperAdmin,
  now,
  onClose,
  onChanged,
}: {
  /** Code lu dans le QR code ; vide pour le saisir à la main. */
  initialCode: string;
  groups: Group[];
  configurations: Configuration[];
  screens: AppScreen[];
  /** TV qui attendent d'être connectées (admin). */
  waiting: AppScreen[];
  userId: string;
  isSuperAdmin: boolean;
  now: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useFeedback();
  const [code, setCode] = useState(normalizeCode(initialCode));
  const [tv, setTv] = useState<WaitingTv | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'searching' | 'missing'>('idle');
  const [phase, setPhase] = useState<'form' | 'connecting' | 'done' | 'timeout'>('form');

  // Dernier mur utilisé (scans successifs) ; sinon le seul restaurant disponible.
  const [recalled] = useState(() => {
    const w = recallWall();
    return w && configurations.some(c => c.id === w.configId && c.group_id === w.groupId) ? w : null;
  });
  const [groupId, setGroupId] = useState(recalled?.groupId ?? (groups.length === 1 ? groups[0].id : ''));
  const [configId, setConfigId] = useState(recalled?.configId ?? '');
  /** Sens forcé à la main ; null = sens du premier écran du mur. */
  const [upsideDown, setUpsideDown] = useState<boolean | null>(null);
  const [slot, setSlot] = useState<{ x: number; y: number; n: number } | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const cancelled = useRef({ cancelled: false });

  useEffect(() => {
    const signal = cancelled.current;
    signal.cancelled = false;
    return () => {
      signal.cancelled = true;
    };
  }, []);

  // Ménage des TV éteintes depuis longtemps (admin), une fois à l'ouverture.
  const pruned = useRef(false);
  useEffect(() => {
    if (!isSuperAdmin || pruned.current) return;
    pruned.current = true;
    pruneWaitingTvs(waiting).catch(() => undefined);
  }, [isSuperAdmin, waiting]);

  // Recherche de la TV dès que le code est complet.
  useEffect(() => {
    if (!isValidCode(code)) {
      setTv(null);
      setLookup('idle');
      return;
    }
    let stale = false;
    setLookup('searching');
    findWaitingTv(code)
      .then(found => {
        if (stale) return;
        setTv(found);
        setLookup(found ? 'idle' : 'missing');
      })
      .catch(() => !stale && setLookup('missing'));
    return () => {
      stale = true;
    };
  }, [code]);

  const group = groups.find(g => g.id === groupId) || null;
  const groupConfigs = useMemo(() => configurations.filter(c => c.group_id === groupId), [configurations, groupId]);
  const config = groupConfigs.find(c => c.id === configId) || (groupConfigs.length === 1 ? groupConfigs[0] : null);
  const { rows, cols } = config ? parseFormat(config.format) : { rows: 1, cols: 1 };
  const inConfig = useMemo(() => (config ? screens.filter(s => s.configuration_id === config.id) : []), [screens, config]);
  // Place par défaut : la première place libre, dans l'ordre de lecture (gauche → droite, haut → bas).
  // On scanne les TV dans cet ordre, chacune prend la place suivante.
  const autoSlot = useMemo(() => {
    for (let i = 0; i < rows * cols; i++) {
      const x = i % cols;
      const y = Math.floor(i / cols);
      if (!inConfig.some(s => s.pos_x === x && s.pos_y === y)) return { x, y, n: i + 1 };
    }
    return null;
  }, [inConfig, rows, cols]);
  const place = slot ?? autoSlot;
  const occupant = place ? inConfig.find(s => s.pos_x === place.x && s.pos_y === place.y) || null : null;

  // Sens de la TV : celui de l'écran remplacé, sinon celui du premier écran du mur (place 1, ou le premier trouvé).
  const reference = occupant ?? inConfig.find(s => s.pos_x === 0 && s.pos_y === 0) ?? [...inConfig].sort((a, b) => a.pos_y - b.pos_y || a.pos_x - b.pos_x)[0];
  const inherited = reference?.rotation === 180;
  const flipped = upsideDown ?? inherited;
  const canRotate = !!tv && (screenVersionCode(tv) ?? 0) >= 6;

  // Nom proposé : restaurant (+ mur s'il y en a plusieurs) + numéro de position.
  const suggested = group && config && place ? cleanScreenName(`${group.name}${groupConfigs.length > 1 ? ` ${config.name}` : ''} ${place.n}`) : '';
  const finalName = occupant ? occupant.id : (nameTouched ? name : suggested).trim();
  const ready = !!tv && !!config && !!place && finalName.length >= 2;
  const [donePlace, setDonePlace] = useState<number | null>(null);
  const [lastName, setLastName] = useState('');

  const connect = async () => {
    if (!tv || !config || !place || !finalName) return;
    const since = Date.now();
    setPhase('connecting');
    try {
      await pairTv(code, {
        name: finalName,
        replace: !!occupant,
        config,
        group,
        x: place.x,
        y: place.y,
        cols,
        rows,
        sibling: inConfig.find(s => s.id !== occupant?.id),
        rotation: canRotate && flipped ? 180 : 0,
        ownerId: group?.user_id ?? (isSuperAdmin ? null : userId),
      });
      onChanged();
      const ok = await waitForTv(finalName, since, cancelled.current);
      if (cancelled.current.cancelled) return;
      if (ok) {
        await removeWaitingTv(code);
        rememberWall(config.group_id, config.id);
        // Confirmation sur la TV elle-même : son numéro de place s'affiche en grand.
        if (canRotate) sendScreenCommand([finalName], 'identify').catch(() => undefined);
        setDonePlace(place.n);
        setLastName(finalName);
        onChanged();
        setPhase('done');
      } else setPhase('timeout');
    } catch (err) {
      setPhase('form');
      toast(errorMessage(err), 'error');
    }
  };

  // Après une connexion : on garde le mur, la TV suivante prendra la place libre suivante.
  const nextTv = () => {
    setCode('');
    setTv(null);
    setSlot(null);
    setName('');
    setNameTouched(false);
    setUpsideDown(null);
    setDonePlace(null);
    setPhase('form');
  };

  const onlineWaiting = waiting.filter(w => isOnline(w.last_ping, now));
  const busy = phase === 'connecting';

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title="Connecter une TV"
      footer={
        phase === 'form' && tv ? (
          <Button block size="lg" icon={<Link2 className="h-5 w-5" />} disabled={!ready} onClick={connect}>
            {occupant ? `Remplacer ${occupant.id}` : 'Connecter'}
          </Button>
        ) : phase === 'done' ? (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="secondary" onClick={onClose}>
              Terminé
            </Button>
            <Button size="lg" icon={<Plus className="h-5 w-5" />} disabled={!autoSlot} onClick={nextTv}>
              TV suivante
            </Button>
          </div>
        ) : phase === 'timeout' ? (
          <Button block size="lg" icon={<RefreshCw className="h-5 w-5" />} onClick={connect}>
            Réessayer
          </Button>
        ) : undefined
      }
    >
      {phase === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center animate-in fade-in zoom-in-95 duration-300">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-11 w-11" />
          </span>
          <p className="text-2xl font-extrabold text-ink">Connectée</p>
          <p className="text-sm font-semibold text-muted">
            {lastName}
            {donePlace ? ` · place ${donePlace}` : ''}
          </p>
        </div>
      ) : phase === 'connecting' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-brand" />
          <p className="text-lg font-extrabold text-ink">Connexion…</p>
          <p className="text-sm text-muted">{finalName}</p>
        </div>
      ) : phase === 'timeout' ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <WifiOff className="h-8 w-8" />
          </span>
          <p className="text-lg font-extrabold text-ink">La TV ne répond pas</p>
          <p className="max-w-xs text-sm text-muted">Vérifiez qu’elle est allumée et connectée à internet.</p>
        </div>
      ) : !tv ? (
        /* ---------- Étape 1 : le code ---------- */
        <div className="space-y-4">
          <div className="relative">
            <Input
              autoFocus={!initialCode}
              value={code}
              onChange={e => setCode(normalizeCode(e.target.value))}
              placeholder="CODE"
              aria-label="Code affiché sur la TV"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="h-16 text-center font-mono !text-2xl font-black tracking-[0.35em] placeholder:tracking-[0.35em]"
            />
            {lookup === 'searching' && <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {lookup === 'missing' && (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-700">TV introuvable · vérifiez le code à l’écran</p>
          )}
          {isSuperAdmin && onlineWaiting.length > 0 && (
            <div className="space-y-2">
              <p className="eyebrow px-1">TV détectées</p>
              {onlineWaiting.map(w => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setCode(codeOf(w.id))}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left transition hover:border-brand/40 hover:bg-brand-50/40 active:scale-[0.99]"
                >
                  <StatusDot online />
                  <span className="font-mono text-base font-black tracking-widest text-ink">{codeOf(w.id)}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{w.device_model}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<Tv className="h-6 w-6" />} title="Aucun restaurant" text="Créez d’abord un restaurant et son mur d’écrans." />
      ) : (
        /* ---------- Étape 2 : la place ---------- */
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white">
            <Tv className="h-5 w-5 flex-shrink-0 text-brand-300" />
            <span className="font-mono text-base font-black tracking-widest">{code}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-white/60">{tv.device_model}</span>
            <StatusDot online={isOnline(tv.last_ping, now)} />
          </div>

          {groups.length > 1 && (
            <Select
              value={groupId}
              aria-label="Restaurant"
              onChange={e => {
                setGroupId(e.target.value);
                setConfigId('');
                setSlot(null);
              }}
            >
              <option value="">Restaurant</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}

          {group && groupConfigs.length > 1 && (
            <Select
              value={config?.id ?? ''}
              aria-label="Mur d’écrans"
              onChange={e => {
                setConfigId(e.target.value);
                setSlot(null);
              }}
            >
              <option value="">Mur d’écrans</option>
              {groupConfigs.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.format}
                </option>
              ))}
            </Select>
          )}

          {group && groupConfigs.length === 0 && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">Ce restaurant n’a pas encore de mur.</p>}

          {config && (
            <div className="space-y-2">
              <p className="eyebrow px-1">
                Position · {group?.name}
                {groupConfigs.length === 1 ? ` · ${config.name}` : ''}
              </p>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {Array.from({ length: rows * cols }, (_, i) => {
                  const x = i % cols;
                  const y = Math.floor(i / cols);
                  const s = inConfig.find(scr => scr.pos_x === x && scr.pos_y === y);
                  const selected = place?.x === x && place?.y === y;
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSlot({ x, y, n: i + 1 })}
                      className={cn(
                        'relative flex aspect-video min-h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border-2 px-1 text-center transition active:scale-[0.97]',
                        selected
                          ? 'border-brand bg-brand text-white shadow-lift'
                          : s
                            ? 'border-transparent bg-ink text-white/90 hover:border-brand/60'
                            : 'border-dashed border-line bg-cream text-muted hover:border-brand/60 hover:text-ink',
                      )}
                    >
                      <span className="text-lg font-black leading-none">{i + 1}</span>
                      <span className="w-full truncate text-[10px] font-bold leading-tight opacity-80">{s ? s.id : 'Libre'}</span>
                      {s && <StatusDot online={isOnline(s.last_ping, now)} className="absolute right-1.5 top-1.5 h-2 w-2" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {config && place && canRotate && (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3.5">
              <FlipVertical2 className="h-5 w-5 flex-shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">TV montée à l’envers</span>
                <span className="block text-xs text-muted">
                  {reference && upsideDown === null ? `Comme ${reference.id}` : 'Le logo SYNK est à l’envers sur la TV ?'}
                </span>
              </span>
              <Switch label="TV montée à l’envers" checked={flipped} onChange={setUpsideDown} />
            </div>
          )}

          {place &&
            (occupant ? (
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Cette TV prendra la place de « {occupant.id} » : même contenu, mêmes réglages.
              </p>
            ) : (
              <Input
                value={nameTouched ? name : suggested}
                onChange={e => {
                  setNameTouched(true);
                  setName(cleanScreenName(e.target.value));
                }}
                placeholder="Nom de l’écran"
                aria-label="Nom de l’écran"
                maxLength={40}
              />
            ))}
        </div>
      )}
    </Modal>
  );
}
