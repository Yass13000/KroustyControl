import { useMemo, useState } from 'react';
import { CheckCircle2, CloudUpload, Loader2, MonitorPlay, PackageCheck, Rocket, Store, TestTube2, XCircle } from 'lucide-react';
import { readApk, PLAYER_PACKAGE, type ApkInfo } from '../lib/apk';
import { deployRelease, isWebPlayer, pruneReleases, screenVersionCode, updateStatus, uploadApk } from '../lib/playerRelease';
import { errorMessage } from '../lib/data';
import { isOnline } from '../lib/media';
import { megabytes } from '../lib/videoAnalysis';
import type { AppScreen, Configuration, Group } from '../lib/types';
import { Button, Modal, Segmented, Select, StatusDot, cn, useFeedback } from './ui';

/**
 * Mises à jour à distance du lecteur TV :
 * déposer l'APK → version et empreinte lues automatiquement → envoi sur Supabase Storage
 * → choix des écrans (test, restaurant, tout) → suivi écran par écran.
 */
export default function PlayerUpdates({
  screens,
  groups,
  configurations,
  now,
  onChanged,
}: {
  screens: AppScreen[];
  groups: Group[];
  configurations: Configuration[];
  now: number;
  onChanged: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [scope, setScope] = useState<'test' | 'group' | 'all'>('test');
  const [testScreen, setTestScreen] = useState('');
  const [groupId, setGroupId] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  const configGroup = useMemo(() => new Map(configurations.map(c => [c.id, c.group_id])), [configurations]);
  const assigned = screens.filter(s => s.configuration_id);

  // Versions actuellement installées
  const versions = useMemo(() => {
    const m = new Map<string, number>();
    screens.forEach(s => {
      const k = s.player_version || 'Ancien (avant 1.1)';
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [screens]);

  // Écrans à qui une version plus récente a été demandée
  // Les lecteurs web ne reçoivent pas d'APK : ils sont exclus des mises à jour.
  const apkScreens = screens.filter(s => !isWebPlayer(s));
  const rollout = apkScreens.filter(s => (s.latest_version_code || 0) > 1 && s.apk_url);
  const targetCode = Math.max(0, ...rollout.map(s => s.latest_version_code || 0));
  const inRollout = rollout.filter(s => (s.latest_version_code || 0) === targetCode);
  const doneCount = inRollout.filter(s => (screenVersionCode(s) ?? -1) >= targetCode).length;

  const reset = () => {
    setFile(null);
    setInfo(null);
    setReadError(null);
    setProgress(null);
  };

  const pick = async (f: File | null) => {
    reset();
    if (!f) return;
    setFile(f);
    try {
      const i = await readApk(f);
      if (i.packageName !== PLAYER_PACKAGE) throw new Error(`Ce n’est pas le lecteur SYNK (${i.packageName || 'identifiant inconnu'})`);
      setInfo(i);
    } catch (err) {
      setReadError(errorMessage(err));
    }
  };

  const targets = (): string[] => {
    if (scope === 'test') return testScreen ? [testScreen] : [];
    if (scope === 'group') return assigned.filter(s => !isWebPlayer(s) && s.configuration_id && configGroup.get(s.configuration_id) === groupId).map(s => s.id);
    return apkScreens.map(s => s.id);
  };

  const deploy = async () => {
    if (!file || !info) return;
    const ids = targets();
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Déployer la version ${info.versionName} ?`,
      message: `${ids.length} écran${ids.length > 1 ? 's' : ''} · installation à la prochaine synchro (≤ 1 min)`,
      confirmLabel: 'Déployer',
    });
    if (!ok) return;
    try {
      setProgress(0);
      const url = await uploadApk(file, info, setProgress);
      await deployRelease(ids, info, url);
      pruneReleases([url, ...screens.map(s => s.apk_url || '')]).catch(() => undefined);
      toast('Mise à jour lancée');
      setOpen(false);
      reset();
      onChanged();
    } catch (err) {
      setProgress(null);
      toast(errorMessage(err), 'error');
    }
  };

  const ids = targets();

  return (
    <section className="space-y-3">
      <div className="card space-y-4 p-4">
        {/* Versions installées + nouvelle version */}
        <div className="flex flex-wrap items-center gap-2">
          {versions.map(([v, n]) => (
            <span key={v} className="inline-flex items-center gap-1.5 rounded-full bg-cream px-3 py-1 text-sm font-semibold text-ink">
              <PackageCheck className="h-4 w-4 text-brand" />
              {v}
              <span className="text-muted">· {n}</span>
            </span>
          ))}
          <Button size="sm" className="ml-auto" icon={<CloudUpload className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Mettre à jour
          </Button>
        </div>

        {/* Déploiement en cours */}
        {inRollout.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-ink">Version {targetCode}</span>
              <span className="font-semibold tabular-nums text-muted">
                {doneCount}/{inRollout.length} à jour
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sand">
              <div className="h-full rounded-full bg-online transition-all duration-500" style={{ width: `${(doneCount / inRollout.length) * 100}%` }} />
            </div>
            <ul className="divide-y divide-sand rounded-2xl border border-sand">
              {inRollout.map(s => {
                const on = isOnline(s.last_ping, now);
                const st = updateStatus(s, on);
                return (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <StatusDot online={on} sleeping={s.power_state === 'sleep'} />
                    <span className="min-w-0 flex-1 truncate font-bold text-ink">{s.id}</span>
                    <span
                      className={cn(
                        'flex items-center gap-1.5 text-right text-xs font-semibold',
                        st.tone === 'done' && 'text-emerald-700',
                        st.tone === 'failed' && 'text-red-600',
                        st.tone === 'progress' && 'text-brand-700',
                        (st.tone === 'waiting' || st.tone === 'offline') && 'text-muted',
                      )}
                    >
                      {st.tone === 'done' && <CheckCircle2 className="h-4 w-4" />}
                      {st.tone === 'failed' && <XCircle className="h-4 w-4" />}
                      {st.tone === 'progress' && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span className="max-w-[170px] truncate" title={st.label}>
                        {st.label}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* --- Nouvelle version --- */}
      <Modal
        open={open}
        onClose={() => progress === null && (setOpen(false), reset())}
        title="Mettre à jour les lecteurs"
        footer={
          <Button block size="lg" icon={<Rocket className="h-5 w-5" />} loading={progress !== null} disabled={!info || ids.length === 0} onClick={deploy}>
            {progress !== null ? `Envoi ${Math.round(progress * 100)} %` : ids.length ? `Déployer sur ${ids.length} écran${ids.length > 1 ? 's' : ''}` : 'Déployer'}
          </Button>
        }
      >
        <div className="space-y-4">
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition',
              info ? 'border-emerald-300 bg-emerald-50/50' : 'border-line bg-cream/50 hover:border-brand/50',
              progress !== null && 'pointer-events-none opacity-70',
            )}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0] || null);
            }}
          >
            <CloudUpload className="h-7 w-7 text-brand" />
            {info ? (
              <>
                <span className="text-[15px] font-extrabold text-ink">Lecteur SYNK {info.versionName}</span>
                <span className="text-xs text-muted">
                  code {info.versionCode} · {megabytes(info.size)} · empreinte {info.sha256.slice(0, 10)}…
                </span>
              </>
            ) : file && !readError ? (
              <span className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Lecture de l’APK…
              </span>
            ) : (
              <span className="text-sm font-bold text-ink">Choisir l’APK du lecteur</span>
            )}
            <input type="file" accept=".apk,application/vnd.android.package-archive" className="sr-only" onChange={e => pick(e.target.files?.[0] || null)} />
          </label>

          {readError && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{readError}</p>}

          {info && (
            <>
              <Segmented
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'test', label: 'Écran test', icon: <TestTube2 className="h-4 w-4" /> },
                  { value: 'group', label: 'Restaurant', icon: <Store className="h-4 w-4" /> },
                  { value: 'all', label: 'Tout', icon: <MonitorPlay className="h-4 w-4" /> },
                ]}
              />
              {scope === 'test' && (
                <Select value={testScreen} onChange={e => setTestScreen(e.target.value)} aria-label="Écran test">
                  <option value="">Choisir l’écran test</option>
                  {apkScreens.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                      {isOnline(s.last_ping, now) ? '' : ' (hors ligne)'}
                    </option>
                  ))}
                </Select>
              )}
              {scope === 'group' && (
                <Select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Restaurant">
                  <option value="">Choisir le restaurant</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
              <p className="px-1 text-xs text-muted">L’APK doit être signé avec la même clé que les lecteurs installés.</p>
            </>
          )}

          {progress !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-sand">
              <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${Math.max(3, progress * 100)}%` }} />
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
}
