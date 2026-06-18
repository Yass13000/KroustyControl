import React, { useState, useEffect } from 'react';

interface Screen {
  id: string;
  group_id: string | null;
  last_ping: string | null;
  pos_x: number;
  pos_y: number;
  video_url: string | null;
  audio_url: string | null;
}

interface Group {
  id: string;
  name: string;
  format: string;
  open_time?: string | null;
  close_time?: string | null;
}

interface SupabaseAlbum {
  id: string;
  name: string;
}

interface SupabaseVideo {
  id: string;
  album_id: string;
  name: string;
  url: string;
}

interface BroadcastProps {
  availableScreens: Screen[];
  availableGroups: Group[];
  sbClient: any;
  attributionInputs: Record<string, string>;
  setAttributionInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  groupModes: Record<string, 'global' | 'per-screen'>;
  setGroupModes: React.Dispatch<React.SetStateAction<Record<string, 'global' | 'per-screen'>>>;
}

export default function Broadcast({
  availableScreens,
  availableGroups,
  sbClient,
  attributionInputs,
  setAttributionInputs,
  groupModes,
  setGroupModes
}: BroadcastProps) {
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { open: string; close: string }>>({});
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  const [albums, setAlbums] = useState<SupabaseAlbum[]>([]);
  const [allVideos, setAllVideos] = useState<SupabaseVideo[]>([]);
  const [videoPickerTarget, setVideoPickerTarget] = useState<string | null>(null);
  const [openedAlbumId, setOpenedAlbumId] = useState<string | null>(null);

  // Activation sélective des sections pour la sauvegarde ciblé
  const [activeEdits, setActiveEdits] = useState<Record<string, boolean>>({
    schedule: false,
    audio: false,
    video: false
  });

  // Gestion du mode d'insertion vidéo (bibliothèque ou lien manuel) par clé d'attribution
  const [videoModes, setVideoModes] = useState<Record<string, 'library' | 'manual'>>({});

  // =========================================================
  // 🛡️ AUTOMATE DE SÉCURISATION POUR LES LIENS AUDIO MUTUALISÉS
  // =========================================================
  const transformStorageUrl = (url: string): string => {
    let cleanUrl = url.trim();
    if (!cleanUrl) return '';

    // Convertisseur Dropbox (Streaming direct audio/vidéo sans téléchargement forcé)
    if (cleanUrl.includes('dropbox.com')) {
      let directUrl = cleanUrl.replace('www.dropbox.com', 'dl.dropboxusercontent.com');
      directUrl = directUrl.replace('dl=0', 'raw=1').replace('dl=1', 'raw=1');
      if (!directUrl.includes('raw=1')) {
        directUrl += directUrl.includes('?') ? '&raw=1' : '?raw=1';
      }
      return directUrl;
    }

    // Convertisseur Google Drive (Flux direct export)
    if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('docs.google.com')) {
      const regExpId = /\/d\/([a-zA-Z0-9-_]+)/;
      const regExpParam = /[?&]id=([a-zA-Z0-9-_]+)/;
      const matchId = cleanUrl.match(regExpId);
      const matchParam = cleanUrl.match(regExpParam);
      const fileId = (matchId && matchId[1]) || (matchParam && matchParam[1]);
      if (fileId) {
        return `https://docs.google.com/uc?export=download&id=${fileId}`;
      }
    }

    return cleanUrl;
  };

  // Charger les dossiers et vidéos
  useEffect(() => {
    const loadLibraryData = async () => {
      const { data: rawAlbums } = await sbClient.from('albums').select('*').order('name', { ascending: true });
      const { data: rawVideos } = await sbClient.from('videos').select('*').order('name', { ascending: true });
      setAlbums(rawAlbums || []);
      setAllVideos(rawVideos || []);
    };
    loadLibraryData();
  }, [sbClient]);

  // Sélectionner le premier restaurant par défaut au démarrage
  useEffect(() => {
    if (availableGroups.length > 0 && Object.keys(selectedGroups).length === 0) {
      setSelectedGroups({ [availableGroups[0].id]: true });
    }
  }, [availableGroups]);

  // Remplir les cases sans écraser ce que tu écris
  useEffect(() => {
    const initialSchedules = { ...scheduleInputs };
    const initialAttributions = { ...attributionInputs };
    let changement = false;

    availableGroups.forEach(group => {
      if (!initialSchedules[group.id]) {
        initialSchedules[group.id] = {
          open: group.open_time || '08:00',
          close: group.close_time || '22:00'
        };
        changement = true;
      }

      const screensInGroup = availableScreens.filter(s => s.group_id === group.id);
      if (screensInGroup.length > 0) {
        const firstScreen = screensInGroup.find(scr => scr.pos_x === 0 && scr.pos_y === 0);
        const audioKey = `${group.id}-restaurant-audio`;
        if (initialAttributions[audioKey] === undefined) {
          initialAttributions[audioKey] = firstScreen?.audio_url || '';
          changement = true;
        }

        const videoKey = `${group.id}-global-video`;
        if (initialAttributions[videoKey] === undefined) {
          initialAttributions[videoKey] = screensInGroup[0]?.video_url || '';
          changement = true;
        }

        screensInGroup.forEach(s => {
          const localVideoKey = `${s.id}-video`;
          if (initialAttributions[localVideoKey] === undefined) {
            initialAttributions[localVideoKey] = s.video_url || '';
            changement = true;
          }
        });
      }
    });

    if (changement) {
      setScheduleInputs(initialSchedules);
      setAttributionInputs(initialAttributions);
    }
  }, [availableGroups, availableScreens]);

  const formatReadableName = (formatStr: string) => {
    if (formatStr === '1x1') return "1 Écran seul";
    if (formatStr === '1x2') return "2 Écrans alignés";
    if (formatStr === '1x3') return "3 Écrans alignés";
    if (formatStr === '1x4') return "4 Écrans alignés";
    if (formatStr === '2x2') return "4 Écrans en carré (2x2)";
    return formatStr;
  };

  const changeGroupMode = (groupId: string, value: 'global' | 'per-screen') => {
    setGroupModes(prev => ({
      ...prev,
      [groupId]: value
    }));
  };

  const updateAttributionInput = (key: string, value: string) => {
    setAttributionInputs(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const updateScheduleInput = (groupId: string, type: 'open' | 'close', value: string) => {
    setScheduleInputs(prev => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        [type]: value
      }
    }));
  };

  const toggleGroupSelection = (groupId: string, format: string) => {
    setSelectedGroups(prev => {
      const next = { ...prev };
      if (next[groupId]) {
        delete next[groupId];
        return next;
      }
      const alreadySelectedIds = Object.keys(next).filter(id => next[id]);
      if (alreadySelectedIds.length > 0) {
        const firstSelected = availableGroups.find(g => g.id === alreadySelectedIds[0]);
        if (firstSelected && firstSelected.format !== format) {
          return { [groupId]: true };
        }
      }
      next[groupId] = true;
      return next;
    });
  };

  const getVideoNameByUrl = (url: string) => {
    if (!url) return "";
    const found = allVideos.find(v => v.url === url);
    return found ? found.name : "Vidéo sélectionnée";
  };

  const openVideoPicker = (targetKey: string) => {
    setVideoPickerTarget(targetKey);
    setOpenedAlbumId(null);
  };

  const selectVideoForTarget = (videoUrl: string) => {
    if (!videoPickerTarget) return;
    updateAttributionInput(videoPickerTarget, videoUrl);
    setVideoPickerTarget(null);
    setOpenedAlbumId(null);
  };

  const applyConfig = async () => {
    const targetGroupIds = Object.keys(selectedGroups).filter(id => selectedGroups[id]);
    if (isSaving || targetGroupIds.length === 0) return;

    if (!activeEdits.schedule && !activeEdits.audio && !activeEdits.video) {
      alert("Veuillez cocher au moins une section à modifier avant d'enregistrer.");
      return;
    }

    setIsSaving(true);
    try {
      const promises: Promise<any>[] = [];

      for (const groupId of targetGroupIds) {
        const group = availableGroups.find(g => g.id === groupId);
        if (!group) continue;

        const mode = groupModes[group.id] || 'global';
        const screensInGroup = availableScreens.filter(s => s.group_id === group.id);
        const [formatRows, formatCols] = group.format.split('x').map(Number);
        const sourceGroupId = targetGroupIds[0];

        if (activeEdits.schedule) {
          const schedule = scheduleInputs[sourceGroupId] || { open: '08:00', close: '22:00' };
          promises.push(
            sbClient.from('groups')
              .update({ open_time: schedule.open, close_time: schedule.close })
              .eq('id', group.id)
          );
        }

        if (activeEdits.video || activeEdits.audio) {
          const rawAudioUrl = (attributionInputs[`${sourceGroupId}-restaurant-audio`] || '').trim();
          const restaurantAudioUrl = transformStorageUrl(rawAudioUrl);
          const globalVideoUrl = (attributionInputs[`${sourceGroupId}-global-video`] || '').trim();

          screensInGroup.forEach(s => {
            const isFirstScreen = s.pos_x === 0 && s.pos_y === 0;
            const videoKey = targetGroupIds.length === 1 ? `${s.id}-video` : `${screensInGroup[0]?.id}-video`;
            const localVideoUrl = (attributionInputs[videoKey] || '').trim();

            const screenPayload: Record<string, any> = {
              total_cols: formatCols,
              total_rows: formatRows,
              pos_x: s.pos_x,
              pos_y: s.pos_y
            };

            if (activeEdits.video) {
              screenPayload.video_url = mode === 'global' ? globalVideoUrl : localVideoUrl;
            }
            if (activeEdits.audio) {
              screenPayload.audio_url = isFirstScreen ? restaurantAudioUrl : '';
            }

            promises.push(
              sbClient.from('screens_config')
                .update(screenPayload)
                .eq('id', s.id)
            );
          });
        }
      }

      await Promise.all(promises);
      alert("Enregistré ! Seuls les réglages cochés ont été appliqués.");
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la sauvegarde.");
    } finally {
      setIsSaving(false);
    }
  };

  const targetGroupIds = Object.keys(selectedGroups).filter(id => selectedGroups[id]);
  const selectedCount = targetGroupIds.length;

  let workspaceContent: React.ReactNode = null;

  if (selectedCount === 1) {
    const group = availableGroups.find(g => g.id === targetGroupIds[0])!;
    const [rows, cols] = group.format.split('x').map(Number);
    const screensInGroup = availableScreens.filter(s => s.group_id === group.id);
    const currentMode = groupModes[group.id] || 'global';
    const audioKey = `${group.id}-restaurant-audio`;
    const videoKey = `${group.id}-global-video`;

    const slots: React.ReactNode[] = [];
    let slotCounter = 1;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const s = screensInGroup.find(scr => scr.pos_x === x && scr.pos_y === y);
        slots.push(
          <div
            key={`slot-${y}-${x}`}
            className={`rounded-2xl flex flex-col items-center justify-center p-3 border transition-all h-20 shadow-inner ${
              s ? 'bg-[#ff751f]/10 border-[#ff751f]/20 text-[#ff751f]' : 'bg-[#faf6f0]/50 border-dashed border-[#e3dad0] text-[#7c6258]'
            }`}
          >
            <span className="text-[9px] font-bold opacity-60 tracking-wider">
              ÉCRAN {slotCounter} {x === 0 && y === 0 ? '' : ''}
            </span>
            <span className="text-[11px] font-black truncate max-w-full mt-1 tracking-tight">
              {s ? s.id : 'Vide'}
            </span>
          </div>
        );
        slotCounter++;
      }
    }

    let inputsHtml: React.ReactNode = null;
    if (currentMode === 'global') {
      const currentVideoUrl = attributionInputs[videoKey] || '';
      const isManual = videoModes[videoKey] === 'manual';

      inputsHtml = (
        <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={activeEdits.video}
                onChange={(e) => setActiveEdits(prev => ({ ...prev, video: e.target.checked }))}
                className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
              />
              <span className="text-[9px] font-extrabold text-[#ff751f] uppercase tracking-widest">Vidéo</span>
            </div>
            {/* Beau switch visuel à icônes */}
            <button
              type="button"
              onClick={() => setVideoModes(prev => ({ ...prev, [videoKey]: isManual ? 'library' : 'manual' }))}
              className="flex items-center gap-0.5 p-0.5 rounded-xl border border-[#e3dad0] bg-[#faf6f0] shadow-inner transition-all active:scale-95"
            >
              <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🔗</div>
              <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${!isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🖥</div>
            </button>
          </div>
          <div className={`transition-opacity duration-200 ${!activeEdits.video ? 'opacity-40 pointer-events-none' : ''}`}>
            {isManual ? (
              <input
                type="text"
                disabled={isSaving || !activeEdits.video}
                value={currentVideoUrl}
                onChange={(e) => updateAttributionInput(videoKey, e.target.value)}
                placeholder="Coller l'URL de votre vidéo ici..."
                className="w-full bg-white border border-[#e3dad0] rounded-xl p-3.5 text-xs text-[#b74b1b] font-semibold outline-none shadow-inner"
              />
            ) : (
              <button
                type="button"
                disabled={isSaving || !activeEdits.video}
                onClick={() => openVideoPicker(videoKey)}
                className="w-full bg-white border border-[#e3dad0] rounded-xl p-3.5 text-xs font-semibold shadow-inner text-left text-[#b74b1b] flex items-center justify-between"
              >
                <span className="truncate flex-1">
                  {currentVideoUrl ? getVideoNameByUrl(currentVideoUrl) : "Cliquez pour choisir une vidéo..."}
                </span>
                <span className="text-[#ff751f] text-sm font-black">🖥</span>
              </button>
            )}
          </div>
        </div>
      );
    } else {
      let localCounter = 1;
      const inputsList: React.ReactNode[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const s = screensInGroup.find(scr => scr.pos_x === x && scr.pos_y === y);
          if (s) {
            const localVideoKey = `${s.id}-video`;
            const currentVideoUrl = attributionInputs[localVideoKey] || '';
            const isManual = videoModes[localVideoKey] === 'manual';

            inputsList.push(
              <div key={s.id} className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={activeEdits.video}
                      onChange={(e) => setActiveEdits(prev => ({ ...prev, video: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
                    />
                    <span className="text-[9px] font-extrabold text-[#ff751f] uppercase tracking-widest">Écran {localCounter}</span>
                  </div>
                  {/* Beau switch visuel à icônes */}
                  <button
                    type="button"
                    onClick={() => setVideoModes(prev => ({ ...prev, [localVideoKey]: isManual ? 'library' : 'manual' }))}
                    className="flex items-center gap-0.5 p-0.5 rounded-xl border border-[#e3dad0] bg-[#faf6f0] shadow-inner transition-all active:scale-95"
                  >
                    <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🔗</div>
                    <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${!isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🖥</div>
                  </button>
                </div>
                <div className={`transition-opacity duration-200 ${!activeEdits.video ? 'opacity-40 pointer-events-none' : ''}`}>
                  {isManual ? (
                    <input
                      type="text"
                      disabled={isSaving || !activeEdits.video}
                      value={currentVideoUrl}
                      onChange={(e) => updateAttributionInput(localVideoKey, e.target.value)}
                      placeholder="Coller l'URL de votre vidéo ici..."
                      className="w-full bg-white border border-[#e3dad0] rounded-xl p-3.5 text-xs text-[#b74b1b] font-semibold outline-none shadow-inner"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={isSaving || !activeEdits.video}
                      onClick={() => openVideoPicker(localVideoKey)}
                      className="w-full bg-white border border-[#e3dad0] rounded-xl p-3.5 text-xs font-semibold shadow-inner text-left text-[#b74b1b] flex items-center justify-between"
                    >
                      <span className="truncate flex-1">
                        {currentVideoUrl ? getVideoNameByUrl(currentVideoUrl) : "Cliquez pour choisir une vidéo..."}
                      </span>
                      <span className="text-[#ff751f] text-sm font-black">🖥</span>
                    </button>
                  )}
                </div>
              </div>
            );
          }
          localCounter++;
        }
      }
      inputsHtml = <div className="space-y-3">{inputsList}</div>;
    }

    workspaceContent = (
      <div className="glass-card p-6 space-y-5 shadow-xl border border-[#ff751f]/10">
        <div className="flex justify-between items-center border-b border-[#f2ede4] pb-3.5">
          <div>
            <h2 className="text-sm font-bold text-[#b74b1b] uppercase tracking-wider">{group.name}</h2>
            <p className="text-[10px] text-[#ff751f] font-semibold mt-0.5">{formatReadableName(group.format)}</p>
          </div>
          <select
            disabled={isSaving}
            value={currentMode}
            onChange={(e) => changeGroupMode(group.id, e.target.value as 'global' | 'per-screen')}
            className="bg-white text-[#b74b1b] border border-[#e3dad0] text-[10px] font-extrabold px-3 py-2 rounded-xl outline-none cursor-pointer hover:bg-[#faf6f0] transition-colors disabled:opacity-50"
          >
            <option value="global">Unique</option>
            <option value="per-screen">Séparé</option>
          </select>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {slots}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-between space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <input
                type="checkbox"
                checked={activeEdits.schedule}
                onChange={(e) => setActiveEdits(prev => ({ ...prev, schedule: e.target.checked }))}
                className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
              />
              <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Horaires</span>
            </div>
            <div className={`grid grid-cols-2 gap-4 transition-opacity duration-200 ${!activeEdits.schedule ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 px-0.5">
                  <span className="text-[11px]">☀️</span>
                  <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Allumage</span>
                </div>
                <input
                  type="time"
                  disabled={isSaving || !activeEdits.schedule}
                  value={scheduleInputs[group.id]?.open || '08:00'}
                  onChange={(e) => updateScheduleInput(group.id, 'open', e.target.value)}
                  className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none cursor-pointer shadow-inner disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 px-0.5">
                  <span className="text-[11px]">🌙</span>
                  <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Extinction</span>
                </div>
                <input
                  type="time"
                  disabled={isSaving || !activeEdits.schedule}
                  value={scheduleInputs[group.id]?.close || '22:00'}
                  onChange={(e) => updateScheduleInput(group.id, 'close', e.target.value)}
                  className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none cursor-pointer shadow-inner disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-center space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <input
                type="checkbox"
                checked={activeEdits.audio}
                onChange={(e) => setActiveEdits(prev => ({ ...prev, audio: e.target.checked }))}
                className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
              />
              <span className="text-[9px] font-extrabold text-[#b74b1b] uppercase tracking-widest">Audio</span>
            </div>
            <div className={`transition-opacity duration-200 ${!activeEdits.audio ? 'opacity-40 pointer-events-none' : ''}`}>
              <input
                type="text"
                disabled={isSaving || !activeEdits.audio}
                value={attributionInputs[audioKey] || ''}
                onChange={(e) => updateAttributionInput(audioKey, e.target.value)}
                placeholder="Lien..."
                className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] placeholder-[#e3dad0]/60 font-mono outline-none shadow-inner font-semibold"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          {inputsHtml}
        </div>
      </div>
    );
  } else if (selectedCount > 1) {
    const baseGroupId = targetGroupIds[0];
    const baseGroup = availableGroups.find(g => g.id === baseGroupId)!;
    const audioKey = `${baseGroupId}-restaurant-audio`;
    const videoKey = `${baseGroupId}-global-video`;
    const currentVideoUrl = attributionInputs[videoKey] || '';
    const isManual = videoModes[videoKey] === 'manual';

    workspaceContent = (
      <div className="glass-card p-6 space-y-5 shadow-xl border-2 border-dashed border-[#ff751f]/30 bg-[#ff751f]/5">
        <div>
          <h2 className="text-sm font-black text-[#b74b1b] uppercase tracking-wider">Modification groupée ({selectedCount} restaurants)</h2>
          <p className="text-[10px] text-[#ff751f] font-semibold mt-0.5">Format commun : {formatReadableName(baseGroup.format)}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-between space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <input
                type="checkbox"
                checked={activeEdits.schedule}
                onChange={(e) => setActiveEdits(prev => ({ ...prev, schedule: e.target.checked }))}
                className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
              />
              <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Modifier Horaires Communs</span>
            </div>
            <div className={`grid grid-cols-2 gap-4 transition-opacity duration-200 ${!activeEdits.schedule ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 px-0.5">
                  <span className="text-[11px]">☀️</span>
                  <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Allumage</span>
                </div>
                <input
                  type="time"
                  disabled={isSaving || !activeEdits.schedule}
                  value={scheduleInputs[baseGroupId]?.open || '08:00'}
                  onChange={(e) => updateScheduleInput(baseGroupId, 'open', e.target.value)}
                  className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none shadow-inner"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 px-0.5">
                  <span className="text-[11px]">🌙</span>
                  <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Extinction</span>
                </div>
                <input
                  type="time"
                  disabled={isSaving || !activeEdits.schedule}
                  value={scheduleInputs[baseGroupId]?.close || '22:00'}
                  onChange={(e) => updateScheduleInput(baseGroupId, 'close', e.target.value)}
                  className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none shadow-inner"
                />
              </div>
            </div>
          </div>

          <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-center space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <input
                type="checkbox"
                checked={activeEdits.audio}
                onChange={(e) => setActiveEdits(prev => ({ ...prev, audio: e.target.checked }))}
                className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
              />
              <span className="text-[9px] font-extrabold text-[#b74b1b] uppercase tracking-widest">Modifier Musique Commune</span>
            </div>
            <div className={`transition-opacity duration-200 ${!activeEdits.audio ? 'opacity-40 pointer-events-none' : ''}`}>
              <input
                type="text"
                disabled={isSaving || !activeEdits.audio}
                value={attributionInputs[audioKey] || ''}
                onChange={(e) => updateAttributionInput(audioKey, e.target.value)}
                placeholder="Appliquer à tous..."
                className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] placeholder-[#e3dad0]/60 font-mono outline-none shadow-inner font-semibold"
              />
            </div>
          </div>
        </div>

        <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={activeEdits.video}
                onChange={(e) => setActiveEdits(prev => ({ ...prev, video: e.target.checked }))}
                className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
              />
              <span className="text-[9px] font-extrabold text-[#ff751f] uppercase tracking-widest">Vidéo Commune</span>
            </div>
            {/* Beau switch visuel à icônes */}
            <button
              type="button"
              onClick={() => setVideoModes(prev => ({ ...prev, [videoKey]: isManual ? 'library' : 'manual' }))}
              className="flex items-center gap-0.5 p-0.5 rounded-xl border border-[#e3dad0] bg-[#faf6f0] shadow-inner transition-all active:scale-95"
            >
              <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🔗</div>
              <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${!isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🖥</div>
            </button>
          </div>
          <div className={`transition-opacity duration-200 ${!activeEdits.video ? 'opacity-40 pointer-events-none' : ''}`}>
            {isManual ? (
              <input
                type="text"
                disabled={isSaving || !activeEdits.video}
                value={currentVideoUrl}
                onChange={(e) => updateAttributionInput(videoKey, e.target.value)}
                placeholder="Coller l'URL de votre vidéo commune ici..."
                className="w-full bg-white border border-[#e3dad0] rounded-xl p-3.5 text-xs text-[#b74b1b] font-semibold outline-none shadow-inner"
              />
            ) : (
              <button
                type="button"
                disabled={isSaving || !activeEdits.video}
                onClick={() => openVideoPicker(videoKey)}
                className="w-full bg-white border border-[#e3dad0] rounded-xl p-3.5 text-xs font-semibold shadow-inner text-left text-[#b74b1b] flex items-center justify-between"
              >
                <span className="truncate flex-1">
                  {currentVideoUrl ? getVideoNameByUrl(currentVideoUrl) : "Cliquez pour choisir la vidéo commune..."}
                </span>
                <span className="text-[#ff751f] text-sm font-black">🖥</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  } else {
    workspaceContent = (
      <div className="glass-card p-12 text-center text-xs text-[#7c6258] font-bold border border-dashed border-[#e3dad0] bg-[#faf6f0]/10">
        📍 Sélectionnez un ou plusieurs restaurants pour commencer les réglages.
      </div>
    );
  }

  return (
    <div className="space-y-5 page-content">
      {availableGroups.length === 0 ? (
        <div className="glass-card p-8 text-center text-xs text-[#7c6258] border border-dashed border-[#e3dad0]">
          Aucun restaurant disponible.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-3 shadow-md bg-[#faf6f0]/30">
            <div className="text-xs font-black text-[#b74b1b] uppercase tracking-wider mb-1">Choix des établissements</div>
            <div className="flex flex-wrap gap-2">
              {availableGroups.map(group => {
                const isChecked = !!selectedGroups[group.id];
                return (
                  <button
                    key={group.id}
                    type="button"
                    disabled={isSaving}
                    onClick={() => toggleGroupSelection(group.id, group.format)}
                    className={`px-3 py-2.5 rounded-xl border text-[11px] font-bold transition-all flex items-center gap-2 active:scale-95 ${
                      isChecked 
                        ? 'bg-[#ff751f]/10 border-[#ff751f]/40 text-[#ff751f] shadow-sm font-black' 
                        : 'bg-white border-[#e3dad0] text-[#7c6258] opacity-80 hover:opacity-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={isChecked}
                      className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f] pointer-events-none"
                    />
                    <span>{group.name}</span>
                    <span className="text-[9px] opacity-50 font-normal">({group.format})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {workspaceContent}
        </div>
      )}

      {videoPickerTarget !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border border-[#f2ede4] w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center border-b border-[#faf6f0] pb-2">
              <div>
                <h3 className="text-sm font-bold text-[#b74b1b]">Choisir une vidéo</h3>
                <p className="text-[10px] text-[#7c6258] mt-0.5">
                  {openedAlbumId ? "Sélectionnez votre fichier :" : "Sélectionnez un dossier :"}
                </p>
              </div>
              {openedAlbumId && (
                <button
                  type="button"
                  onClick={() => setOpenedAlbumId(null)}
                  className="text-[10px] font-black bg-[#faf6f0] text-[#ff751f] px-2.5 py-1 rounded-xl border border-[#e3dad0]"
                >
                  ⬅ DOSSIERS
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
              {!openedAlbumId ? (
                albums.length === 0 ? (
                  <p className="text-xs text-center text-[#7c6258] py-6 italic">Aucun dossier trouvé.</p>
                ) : (
                  albums.map(album => {
                    const count = allVideos.filter(v => v.album_id === album.id).length;
                    return (
                      <button
                        data-network-id={album.id}
                        key={album.id}
                        type="button"
                        onClick={() => setOpenedAlbumId(album.id)}
                        className="w-full bg-[#faf6f0]/60 hover:bg-[#ff751f]/5 p-3.5 rounded-2xl border border-[#e3dad0] hover:border-[#ff751f]/30 font-bold text-xs text-[#b74b1b] text-left flex justify-between items-center transition-all"
                      >
                        <span className="truncate">🖥 {album.name}</span>
                        <span className="text-[10px] bg-white border border-[#e3dad0] text-[#ff751f] px-2 py-0.5 rounded-full font-black">
                          {count}
                        </span>
                      </button>
                    );
                  })
                )
              ) : (
                allVideos.filter(v => v.album_id === openedAlbumId).length === 0 ? (
                  <p className="text-xs text-center text-[#7c6258] py-6 italic">Ce dossier ne contient aucune vidéo.</p>
                ) : (
                  allVideos.filter(v => v.album_id === openedAlbumId).map(video => (
                    <button
                      key={video.id}
                      type="button"
                      onClick={() => selectVideoForTarget(video.url)}
                      className="w-full bg-[#faf6f0]/60 hover:bg-[#ff751f]/10 p-3 rounded-2xl border border-[#e3dad0] hover:border-[#ff751f]/40 font-bold text-xs text-[#b74b1b] text-left truncate transition-all flex items-center gap-2"
                    >
                      <span className="text-sm">🎬</span>
                      <span className="truncate flex-1">{video.name}</span>
                    </button>
                  ))
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setVideoPickerTarget(null);
                setOpenedAlbumId(null);
              }}
              className="w-full bg-[#faf6f0] text-[#7c6258] text-xs font-bold py-3.5 rounded-2xl transition-colors hover:bg-[#e3dad0]/40 mt-2"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="pt-3">
          <button
            onClick={applyConfig}
            disabled={isSaving}
            className={`w-full bg-gradient-to-r from-[#ff751f] to-[#b74b1b] text-white py-4.5 rounded-2xl font-black text-xs shadow-lg shadow-[#ff751f]/20 uppercase tracking-widest transition-all duration-300 transform btn-glow ${
              isSaving ? 'opacity-50 cursor-not-allowed scale-100' : 'hover:opacity-95 hover:scale-[1.01] active:scale-[0.99]'
            }`}
          >
            {isSaving ? "Enregistrement..." : "Enregistrer les changements"}
          </button>
        </div>
      )}
    </div>
  );
}