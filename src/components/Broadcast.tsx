import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Screen {
  id: string;
  configuration_id: string | null;
  last_ping: string | null;
  pos_x: number;
  pos_y: number;
  total_cols: number;
  total_rows: number;
  video_url: string | null;
  audio_url: string | null;
}

interface Group {
  id: string;
  name: string;
  image_url?: string | null;
  open_time?: string | null;
  close_time?: string | null;
}

interface Configuration {
  id: string;
  group_id: string;
  name: string;
  format: string;
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
  availableScreens = [],
  availableGroups = [],
  sbClient,
  attributionInputs,
  setAttributionInputs,
  groupModes,
  setGroupModes
}: BroadcastProps) {
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { open: string; close: string }>>({});
  const [selectedConfigs, setSelectedConfigs] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const [formatFilter, setFormatFilter] = useState<string>('');
  const [restaurantSearch, setRestaurantSearch] = useState<string>('');

  const [localGroups, setLocalGroups] = useState<Group[]>(availableGroups);
  const [localConfigurations, setLocalConfigurations] = useState<Configuration[]>([]);
  const [localScreens, setLocalScreens] = useState<Screen[]>(availableScreens);

  const [albums, setAlbums] = useState<SupabaseAlbum[]>([]);
  const [allVideos, setAllVideos] = useState<SupabaseVideo[]>([]);
  const [videoPickerTarget, setVideoPickerTarget] = useState<string | null>(null);
  const [openedAlbumId, setOpenedAlbumId] = useState<string | null>(null);

  const [activeEdits, useStateActiveEdits] = useState<Record<string, boolean>>({
    schedule: false,
    audio: false,
    video: false
  });

  const [videoModes, setVideoModes] = useState<Record<string, 'library' | 'manual'>>({});
  // État local pour stocker la valeur de l'input manuel avant ajout à la playlist
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  
  const isInitialPopulated = useRef(false);

  const transformStorageUrl = (url: string): string => {
    if (!url) return '';
    if (url.includes(',')) {
      return url.split(',').map(u => transformStorageUrl(u)).join(',');
    }
    let cleanUrl = url.trim();

    if (cleanUrl.includes('dropbox.com')) {
      let directUrl = cleanUrl.replace('www.dropbox.com', 'dl.dropboxusercontent.com');
      directUrl = directUrl.replace('dl=0', 'raw=1').replace('dl=1', 'raw=1');
      if (!directUrl.includes('raw=1')) {
        directUrl += directUrl.includes('?') ? '&raw=1' : '?raw=1';
      }
      return directUrl;
    }

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

  const refreshAllData = useCallback(async () => {
    try {
      const { data: grp } = await sbClient.from('groups').select('*').order('name', { ascending: true });
      const { data: conf } = await sbClient.from('configurations').select('*').order('name', { ascending: true });
      const { data: scr } = await sbClient.from('screens_config').select('*').order('id', { ascending: true });
      
      if (grp) setLocalGroups(grp);
      if (conf) setLocalConfigurations(conf);
      if (scr) setLocalScreens(scr);
    } catch (err) {
      console.error(err);
    }
  }, [sbClient]);

  useEffect(() => {
    refreshAllData();

    const databaseChannel = sbClient
      .channel('broadcast-realtime-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'configurations' }, () => refreshAllData())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'configurations' }, () => refreshAllData())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'configurations' }, () => refreshAllData())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'screens_config' }, (payload: any) => {
        const oldKeys = Object.keys(payload.old || {});
        if (oldKeys.length === 1 && oldKeys[0] === 'last_ping') return;
        refreshAllData();
      })
      .subscribe();

    return () => {
      sbClient.removeChannel(databaseChannel);
    };
  }, [sbClient, refreshAllData]);

  useEffect(() => {
    const loadLibraryData = async () => {
      const { data: rawAlbums } = await sbClient.from('albums').select('*').order('name', { ascending: true });
      const { data: rawVideos } = await sbClient.from('videos').select('*').order('name', { ascending: true });
      setAlbums(rawAlbums || []);
      setAllVideos(rawVideos || []);
    };
    if (sbClient) loadLibraryData();
  }, [sbClient]);

  useEffect(() => {
    if (localConfigurations.length === 0 || localGroups.length === 0 || isInitialPopulated.current) return;

    const initialSchedules = { ...scheduleInputs };
    const initialAttributions = { ...attributionInputs };

    localConfigurations.forEach(config => {
      const parentGroup = localGroups.find(g => g.id === config.group_id);
      
      if (!initialSchedules[config.id]) {
        initialSchedules[config.id] = {
          open: parentGroup?.open_time || '08:00',
          close: parentGroup?.close_time || '22:00'
        };
      }

      const screensInConfig = localScreens.filter(s => s.configuration_id === config.id);
      if (screensInConfig.length > 0) {
        const firstScreen = screensInConfig.find(scr => scr.pos_x === 0 && scr.pos_y === 0);
        const audioKey = `${config.id}-restaurant-audio`;
        if (initialAttributions[audioKey] === undefined) {
          initialAttributions[audioKey] = firstScreen?.audio_url || '';
        }

        const videoKey = `${config.id}-global-video`;
        if (initialAttributions[videoKey] === undefined) {
          initialAttributions[videoKey] = screensInConfig[0]?.video_url || '';
        }

        screensInConfig.forEach(s => {
          const localVideoKey = `${s.id}-video`;
          if (initialAttributions[localVideoKey] === undefined) {
            initialAttributions[localVideoKey] = s.video_url || '';
          }
        });
      }
    });

    setScheduleInputs(initialSchedules);
    setAttributionInputs(initialAttributions);
    isInitialPopulated.current = true;
  }, [localConfigurations, localGroups, localScreens]);

  const formatReadableName = (formatStr: string) => {
    if (formatStr === '1x1') return "1 Écran seul";
    if (formatStr === '1x2') return "2 Écrans alignés";
    if (formatStr === '1x3') return "3 Écrans alignés";
    if (formatStr === '1x4') return "4 Écrans alignés";
    if (formatStr === '2x2') return "4 Écrans en carré (2x2)";
    return formatStr;
  };

  const changeConfigMode = (configId: string, value: 'global' | 'per-screen') => {
    setGroupModes(prev => ({ ...prev, [configId]: value }));
    useStateActiveEdits(prev => ({ ...prev, video: true }));
  };

  const updateAttributionInput = (key: string, value: string) => {
    setAttributionInputs(prev => ({ ...prev, [key]: value }));
    if (key.includes('video')) {
      useStateActiveEdits(prev => ({ ...prev, video: true }));
    } else if (key.includes('audio')) {
      useStateActiveEdits(prev => ({ ...prev, audio: true }));
    }
  };

  const updateScheduleInput = (configId: string, type: 'open' | 'close', value: string) => {
    setScheduleInputs(prev => ({
      ...prev,
      [configId]: { ...prev[configId], [type]: value }
    }));
    useStateActiveEdits(prev => ({ ...prev, schedule: true }));
  };

  const handleFormatChange = (format: string) => {
    setFormatFilter(format);
    setSelectedConfigs({});
  };

  const handleSelectAllFiltered = () => {
    if (!formatFilter) return;
    const newSelection: Record<string, boolean> = {};
    localConfigurations
      .filter(c => c.format === formatFilter)
      .forEach(c => {
        const parentGroup = localGroups.find(g => g.id === c.group_id);
        const matchSearch = restaurantSearch ? parentGroup?.name.toLowerCase().includes(restaurantSearch.toLowerCase()) : true;
        if (matchSearch) {
          newSelection[c.id] = true;
        }
      });
    setSelectedConfigs(newSelection);
  };

  const toggleConfigSelection = (configId: string) => {
    setSelectedConfigs(prev => ({
      ...prev,
      [configId]: !prev[configId]
    }));
  };

  // --- NOUVELLES FONCTIONS PLAYLIST ---
  const getVideoNameByUrl = (url: string) => {
    if (!url) return "";
    const cleanUrl = url.trim();
    const found = allVideos.find(v => v.url === cleanUrl);
    return found ? found.name : "Vidéo Externe";
  };

  const getPlaylistUrls = (key: string): string[] => {
    const raw = attributionInputs[key];
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(s => s !== '');
  };

  const addVideoToPlaylist = (key: string, newUrl: string) => {
    const cleanUrl = newUrl.trim();
    if (!cleanUrl) return;
    
    const currentList = getPlaylistUrls(key);
    // On permet les doublons si l'utilisateur veut lire la même vidéo 2 fois
    currentList.push(cleanUrl);
    
    updateAttributionInput(key, currentList.join(','));
  };

  const removeVideoFromPlaylist = (key: string, indexToRemove: number) => {
    const currentList = getPlaylistUrls(key);
    currentList.splice(indexToRemove, 1);
    updateAttributionInput(key, currentList.join(','));
  };
  // -------------------------------------

  const openVideoPicker = (targetKey: string) => {
    setVideoPickerTarget(targetKey);
    setOpenedAlbumId(null);
  };

  const selectVideoForTarget = (videoUrl: string) => {
    if (!videoPickerTarget) return;
    addVideoToPlaylist(videoPickerTarget, videoUrl);
    // Ne se ferme plus automatiquement pour permettre la multi-sélection rapide
    // setVideoPickerTarget(null);
    // setOpenedAlbumId(null);
  };

  const applyConfig = async () => {
    const targetConfigIds = Object.keys(selectedConfigs).filter(id => selectedConfigs[id]);
    if (isSaving || targetConfigIds.length === 0) return;

    if (!activeEdits.schedule && !activeEdits.audio && !activeEdits.video) {
      alert("Veuillez cocher au moins une section à modifier avant d'enregistrer.");
      return;
    }

    setIsSaving(true);
    try {
      const promises: Promise<any>[] = [];
      const sourceConfigId = targetConfigIds[0];

      if (activeEdits.schedule) {
        const schedule = scheduleInputs[sourceConfigId] || { open: '08:00', close: '22:00' };
        const parentGroupIds = targetConfigIds
          .map(cid => localConfigurations.find(c => c.id === cid)?.group_id)
          .filter((gid): gid is string => !!gid);

        const uniqueGroupIds = Array.from(new Set(parentGroupIds));

        if (uniqueGroupIds.length > 0) {
          promises.push(
            sbClient.from('groups')
              .update({ open_time: schedule.open, close_time: schedule.close })
              .in('id', uniqueGroupIds)
          );
        }
      }

      if (activeEdits.video || activeEdits.audio) {
        const rawAudioUrl = (attributionInputs[`${sourceConfigId}-restaurant-audio`] || '').trim();
        const restaurantAudioUrl = transformStorageUrl(rawAudioUrl);
        const globalVideoUrl = transformStorageUrl((attributionInputs[`${sourceConfigId}-global-video`] || '').trim());

        for (const configId of targetConfigIds) {
          const config = localConfigurations.find(c => c.id === configId);
          if (!config) continue;

          const mode = groupModes[config.id] || 'global';
          const screensInConfig = localScreens.filter(s => s.configuration_id === config.id);
          const [formatRows, formatCols] = config.format.split('x').map(Number);

          if (targetConfigIds.length === 1 && mode === 'per-screen') {
            screensInConfig.forEach(s => {
              const isFirstScreen = s.pos_x === 0 && s.pos_y === 0;
              const localVideoKey = `${s.id}-video`;
              const localVideoUrl = transformStorageUrl((attributionInputs[localVideoKey] || '').trim());

              const payload: Record<string, any> = {
                total_cols: formatCols,
                total_rows: formatRows,
                pos_x: s.pos_x,
                pos_y: s.pos_y
              };
              if (activeEdits.video) payload.video_url = localVideoUrl;
              if (activeEdits.audio) payload.audio_url = isFirstScreen ? restaurantAudioUrl : '';

              promises.push(
                sbClient.from('screens_config').update(payload).eq('id', s.id)
              );
            });
          } else {
            const masterScreenIds: string[] = [];
            const slaveScreenIds: string[] = [];

            screensInConfig.forEach(s => {
              if (s.pos_x === 0 && s.pos_y === 0) masterScreenIds.push(s.id);
              else slaveScreenIds.push(s.id);
            });

            if (masterScreenIds.length > 0) {
              const masterPayload: Record<string, any> = {
                total_cols: formatCols,
                total_rows: formatRows,
                pos_x: 0,
                pos_y: 0
              };
              if (activeEdits.video) masterPayload.video_url = globalVideoUrl;
              if (activeEdits.audio) masterPayload.audio_url = restaurantAudioUrl;

              promises.push(
                sbClient.from('screens_config').update(masterPayload).in('id', masterScreenIds)
              );
            }

            if (slaveScreenIds.length > 0) {
              const slavePayload: Record<string, any> = {
                total_cols: formatCols,
                total_rows: formatRows
              };
              if (activeEdits.video) slavePayload.video_url = globalVideoUrl;
              if (activeEdits.audio) slavePayload.audio_url = '';

              promises.push(
                sbClient.from('screens_config').update(slavePayload).in('id', slaveScreenIds)
              );
            }
          }
        }
      }

      await Promise.all(promises);
      
      setShowToast(true);
      setTimeout(() => setShowToast(false), 1500);

    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredConfigs = localConfigurations.filter(c => {
    const parentGroup = localGroups.find(g => g.id === c.group_id);
    const matchFormat = formatFilter ? c.format === formatFilter : true;
    const matchSearch = restaurantSearch ? parentGroup?.name.toLowerCase().includes(restaurantSearch.toLowerCase()) : true;
    return matchFormat && matchSearch;
  });

  const showResults = formatFilter || restaurantSearch;

  const targetConfigIds = Object.keys(selectedConfigs).filter(id => selectedConfigs[id]);
  const selectedCount = targetConfigIds.length;

  // --- RENDER D'UN BLOC PLAYLIST (GLOBAL OU LOCAL) ---
  const renderPlaylistBlock = (videoKey: string, label: string) => {
    const playlist = getPlaylistUrls(videoKey);
    const isManual = videoModes[videoKey] === 'manual';
    const currentManualInput = manualInputs[videoKey] || '';

    return (
      <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] space-y-3">
        {/* En-tête du bloc avec checkbox et toggle Manuel/Librairie */}
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={activeEdits.video}
              onChange={(e) => useStateActiveEdits(prev => ({ ...prev, video: e.target.checked }))}
              className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
            />
            <span className="text-[9px] font-extrabold text-[#ff751f] uppercase tracking-widest">{label}</span>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => setVideoModes(prev => ({ ...prev, [videoKey]: isManual ? 'library' : 'manual' }))}
            className="flex items-center gap-0.5 p-0.5 rounded-xl border border-[#e3dad0] bg-[#faf6f0] shadow-inner transition-all active:scale-95"
          >
            <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🔗</div>
            <div className={`px-2 py-1 rounded-lg text-[11px] transition-all duration-200 ${!isManual ? 'bg-white shadow-sm scale-100 opacity-100' : 'opacity-30 scale-95'}`}>🖥</div>
          </button>
        </div>

        <div className={`space-y-3 transition-opacity duration-200 ${!activeEdits.video ? 'opacity-40 pointer-events-none' : ''}`}>
          
          {/* AFFICHAGE DES TAGS DE LA PLAYLIST */}
          {playlist.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 bg-white border border-[#e3dad0] rounded-xl shadow-inner max-h-32 overflow-y-auto">
              {playlist.map((url, idx) => (
                <div key={`${url}-${idx}`} className="flex items-center bg-[#ff751f]/10 border border-[#ff751f]/30 rounded-lg pr-1">
                  <span className="text-[10px] font-bold text-[#b74b1b] pl-2 py-1 max-w-[200px] truncate">
                    {idx + 1}. {getVideoNameByUrl(url)}
                  </span>
                  <button 
                    type="button"
                    onClick={() => removeVideoFromPlaylist(videoKey, idx)}
                    className="ml-2 text-[#ff751f] hover:text-red-500 p-1 w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors"
                  >
                    <span className="text-xs font-black">×</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {playlist.length === 0 && (
            <div className="text-center p-3 text-[10px] text-[#7c6258] font-bold border border-dashed border-[#e3dad0] rounded-xl bg-white/50">
              Aucune vidéo dans la séquence. L'écran sera noir.
            </div>
          )}

          {/* ZONE D'AJOUT (MANUEL OU LIBRAIRIE) */}
          {isManual ? (
            <div className="flex gap-2">
              <input
                type="text"
                disabled={isSaving}
                value={currentManualInput}
                onChange={(e) => setManualInputs(prev => ({ ...prev, [videoKey]: e.target.value }))}
                placeholder="URL (Dropbox, Drive, mp4...)"
                className="flex-1 bg-white border border-[#e3dad0] rounded-xl p-3 text-xs text-[#b74b1b] font-semibold outline-none shadow-inner"
              />
              <button
                type="button"
                disabled={!currentManualInput.trim() || isSaving}
                onClick={() => {
                  addVideoToPlaylist(videoKey, currentManualInput);
                  setManualInputs(prev => ({ ...prev, [videoKey]: '' })); // Reset l'input après ajout
                }}
                className="bg-[#ff751f] hover:bg-[#d64f00] text-white px-4 rounded-xl text-xs font-black transition-colors disabled:opacity-50"
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => openVideoPicker(videoKey)}
              className="w-full bg-white border border-[#ff751f]/40 hover:border-[#ff751f] rounded-xl p-3 text-xs font-black shadow-sm text-center text-[#ff751f] transition-colors"
            >
              + Ajouter depuis la Bibliothèque
            </button>
          )}
        </div>
      </div>
    );
  };

  let workspaceContent: React.ReactNode = null;

  if (selectedCount === 1) {
    const config = localConfigurations.find(c => c.id === targetConfigIds[0]);
    if (config) {
      const parentGroup = localGroups.find(g => g.id === config.group_id) || { name: 'Restaurant' };
      const [rows, cols] = config.format.split('x').map(Number);
      const screensInConfig = localScreens.filter(s => s.configuration_id === config.id);
      const currentMode = groupModes[config.id] || 'global';
      const audioKey = `${config.id}-restaurant-audio`;
      const videoKey = `${config.id}-global-video`;

      const slots: React.ReactNode[] = [];
      let slotCounter = 1;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const s = screensInConfig.find(scr => scr.pos_x === x && scr.pos_y === y);
          slots.push(
            <div
              key={`slot-${y}-${x}`}
              className={`rounded-2xl flex flex-col items-center justify-center p-3 border transition-all h-20 shadow-inner ${
                s ? 'bg-[#ff751f]/10 border-[#ff751f]/20 text-[#ff751f]' : 'bg-[#faf6f0]/50 border-dashed border-[#e3dad0] text-[#7c6258]'
              }`}
            >
              <span className="text-[9px] font-bold opacity-60 tracking-wider">
                ÉCRAN {slotCounter}
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
        inputsHtml = renderPlaylistBlock(videoKey, "Séquence Globale (Playlist)");
      } else {
        let localCounter = 1;
        const inputsList: React.ReactNode[] = [];
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const s = screensInConfig.find(scr => scr.pos_x === x && scr.pos_y === y);
            if (s) {
              const localVideoKey = `${s.id}-video`;
              inputsList.push(
                <div key={s.id}>
                  {renderPlaylistBlock(localVideoKey, `Séquence Écran ${localCounter} (Playlist)`)}
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
              <span className="text-[9px] font-black uppercase tracking-wider text-[#ff751f]">{parentGroup.name}</span>
              <h2 className="text-sm font-bold text-[#b74b1b] uppercase tracking-tight mt-0.5">{config.name}</h2>
              <p className="text-[10px] text-[#ff751f] font-semibold mt-0.5">{formatReadableName(config.format)}</p>
            </div>
            <select
              disabled={isSaving}
              value={currentMode}
              onChange={(e) => changeConfigMode(config.id, e.target.value as 'global' | 'per-screen')}
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
                  onChange={(e) => useStateActiveEdits(prev => ({ ...prev, schedule: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
                />
                <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Horaires Restaurant</span>
              </div>
              <div className={`grid grid-cols-2 gap-4 transition-opacity duration-200 ${!activeEdits.schedule ? 'opacity-40 pointer-events-none' : ''}`}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 px-0.5">
                    <span className="text-[11px]">☀️</span>
                    <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Allumage</span>
                  </div>
                  <input
                    type="time"
                    disabled={isSaving}
                    value={scheduleInputs[config.id]?.open || '08:00'}
                    onChange={(e) => updateScheduleInput(config.id, 'open', e.target.value)}
                    className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none cursor-pointer shadow-inner"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 px-0.5">
                    <span className="text-[11px]">🌙</span>
                    <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Extinction</span>
                  </div>
                  <input
                    type="time"
                    disabled={isSaving}
                    value={scheduleInputs[config.id]?.close || '22:00'}
                    onChange={(e) => updateScheduleInput(config.id, 'close', e.target.value)}
                    className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none cursor-pointer shadow-inner"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-center space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <input
                  type="checkbox"
                  checked={activeEdits.audio}
                  onChange={(e) => useStateActiveEdits(prev => ({ ...prev, audio: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
                />
                <span className="text-[9px] font-extrabold text-[#b74b1b] uppercase tracking-widest">Audio d'ambiance</span>
              </div>
              <div className={`transition-opacity duration-200 ${!activeEdits.audio ? 'opacity-40 pointer-events-none' : ''}`}>
                <input
                  type="text"
                  disabled={isSaving}
                  value={attributionInputs[audioKey] || ''}
                  onChange={(e) => updateAttributionInput(audioKey, e.target.value)}
                  placeholder="Lien de flux radio m3u..."
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
    }
  } else if (selectedCount > 1) {
    const baseConfigId = targetConfigIds[0];
    const baseConfig = localConfigurations.find(c => c.id === baseConfigId);
    
    if (baseConfig) {
      const audioKey = `${baseConfigId}-restaurant-audio`;
      const videoKey = `${baseConfigId}-global-video`;

      workspaceContent = (
        <div className="glass-card p-6 space-y-5 shadow-xl border-2 border-dashed border-[#ff751f]/30 bg-[#ff751f]/5">
          <div>
            <h2 className="text-sm font-black text-[#b74b1b] uppercase tracking-wider">Modification groupée ({selectedCount} configurations)</h2>
            <p className="text-[10px] text-[#ff751f] font-semibold mt-0.5">Format de dalles commun : {formatReadableName(baseConfig.format)}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-between space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <input
                  type="checkbox"
                  checked={activeEdits.schedule}
                  onChange={(e) => useStateActiveEdits(prev => ({ ...prev, schedule: e.target.checked }))}
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
                    disabled={isSaving}
                    value={scheduleInputs[baseConfigId]?.open || '08:00'}
                    onChange={(e) => updateScheduleInput(baseConfigId, 'open', e.target.value)}
                    className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none cursor-pointer shadow-inner"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 px-0.5">
                    <span className="text-[11px]">🌙</span>
                    <span className="text-[9px] font-extrabold text-[#7c6258] uppercase tracking-widest">Extinction</span>
                  </div>
                  <input
                    type="time"
                    disabled={isSaving}
                    value={scheduleInputs[baseConfigId]?.close || '22:00'}
                    onChange={(e) => updateScheduleInput(baseConfigId, 'close', e.target.value)}
                    className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] font-bold text-center outline-none cursor-pointer shadow-inner"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#faf6f0]/60 p-4 rounded-2xl border border-[#e3dad0] flex flex-col justify-center space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <input
                  type="checkbox"
                  checked={activeEdits.audio}
                  onChange={(e) => useStateActiveEdits(prev => ({ ...prev, audio: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f]"
                />
                <span className="text-[9px] font-extrabold text-[#b74b1b] uppercase tracking-widest">Modifier Musique Commune</span>
              </div>
              <div className={`transition-opacity duration-200 ${!activeEdits.audio ? 'opacity-40 pointer-events-none' : ''}`}>
                <input
                  type="text"
                  disabled={isSaving}
                  value={attributionInputs[audioKey] || ''}
                  onChange={(e) => updateAttributionInput(audioKey, e.target.value)}
                  placeholder="Appliquer à tous les restaurants parents..."
                  className="w-full bg-white border border-[#e3dad0] rounded-xl p-2.5 text-xs text-[#b74b1b] placeholder-[#e3dad0]/60 font-mono outline-none shadow-inner font-semibold"
                />
              </div>
            </div>
          </div>

          <div className="pt-2">
            {renderPlaylistBlock(videoKey, "Séquence Commune (Playlist)")}
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-5 page-content relative">
      
      {showToast && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] pointer-events-none transition-all duration-300 ease-out">
          <div className="bg-[#ff751f] border border-white/20 backdrop-blur-md text-white text-xs font-black px-7 py-4 rounded-3xl shadow-[0_20px_50px_rgba(255,117,31,0.4)] flex items-center gap-3 uppercase tracking-widest border-b-4 border-b-black/20">
            <span className="text-sm animate-pulse">⚡</span>
            <span>Succès !</span>
          </div>
        </div>
      )}

      {localGroups.length === 0 ? (
        <div className="glass-card p-8 text-center text-xs text-[#7c6258] border border-dashed border-[#e3dad0]">
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-4 shadow-md bg-[#faf6f0]/30">
            
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <select
                value={formatFilter}
                onChange={(e) => handleFormatChange(e.target.value)}
                className="w-full flex-1 bg-white border border-[#e3dad0] rounded-2xl p-4 text-xs font-black text-[#b74b1b] outline-none shadow-inner cursor-pointer"
              >
                <option value="">1. Filtrer par format d'écran...</option>
                <option value="1x1">Format 1x1</option>
                <option value="1x2">Format 1x2</option>
                <option value="1x3">Format 1x3</option>
                <option value="1x4">Format 1x4</option>
                <option value="2x2">Format 2x2</option>
              </select>

              {formatFilter && (
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="w-full sm:w-auto px-6 py-4 bg-[#ff751f]/10 border border-[#ff751f]/30 text-[#ff751f] hover:bg-[#ff751f] hover:text-white text-xs font-extrabold rounded-2xl transition-all duration-200 active:scale-95 whitespace-nowrap shadow-sm"
                >
                  ✓ Tout cocher
                </button>
              )}
            </div>

            <input
              type="text"
              value={restaurantSearch}
              onChange={(e) => {
                setRestaurantSearch(e.target.value);
                setSelectedConfigs({});
              }}
              placeholder="2. Rechercher par nom de restaurant..."
              className="w-full bg-white border border-[#e3dad0] rounded-2xl p-4 text-xs placeholder-[#e3dad0]/60 outline-none font-semibold shadow-inner focus:ring-1 focus:ring-[#ff751f]/10"
            />

            {showResults && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[45vh] overflow-y-auto pr-1 mt-4">
                {filteredConfigs.map(config => {
                  const parentGroup = localGroups.find(g => g.id === config.group_id);
                  const isChecked = !!selectedConfigs[config.id];
                  return (
                    <button
                      key={config.id}
                      type="button"
                      onClick={() => toggleConfigSelection(config.id)}
                      className={`px-3 py-2.5 rounded-xl border text-[11px] font-bold transition-all flex items-center gap-3 text-left active:scale-95 ${
                        isChecked 
                          ? 'bg-[#ff751f]/10 border-[#ff751f]/40 text-[#ff751f] shadow-sm font-black' 
                          : 'bg-white border-[#e3dad0] text-[#7c6258] opacity-90 hover:opacity-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={isChecked}
                        className="w-3.5 h-3.5 rounded border-[#e3dad0] text-[#ff751f] accent-[#ff751f] pointer-events-none flex-shrink-0"
                      />
                      <div className="truncate">
                        <p className="truncate font-bold text-[#b74b1b] tracking-tight">{parentGroup?.name}</p>
                        <p className="text-[9px] opacity-70 font-mono font-normal mt-0.5">{config.name} ({config.format})</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {workspaceContent}
        </div>
      )}

      {videoPickerTarget !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border border-[#f2ede4] w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center border-b border-[#faf6f0] pb-2">
              <div>
                <h3 className="text-sm font-bold text-[#b74b1b]">Ajouter à la playlist</h3>
                <p className="text-[10px] text-[#7c6258] mt-0.5">
                  {openedAlbumId ? "Sélectionnez vos fichiers :" : "Sélectionnez un dossier :"}
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
                        <span className="truncate">📁 {album.name}</span>
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
                      onClick={() => {
                        selectVideoForTarget(video.url);
                        // Ajout d'un petit retour visuel au clic sans fermer la popup
                        const btn = document.getElementById(`btn-${video.id}`);
                        if(btn) {
                          btn.style.backgroundColor = 'rgba(255, 117, 31, 0.2)';
                          setTimeout(() => btn.style.backgroundColor = '', 200);
                        }
                      }}
                      id={`btn-${video.id}`}
                      className="w-full bg-[#faf6f0]/60 hover:bg-[#ff751f]/10 p-3 rounded-2xl border border-[#e3dad0] hover:border-[#ff751f]/40 font-bold text-xs text-[#b74b1b] text-left truncate transition-all flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-sm">🎬</span>
                        <span className="truncate flex-1">{video.name}</span>
                      </div>
                      <span className="text-[#ff751f] text-[10px] font-black opacity-0 group-hover:opacity-100">+ AJOUTER</span>
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
              className="w-full bg-[#ff751f] text-white text-xs font-black py-3.5 rounded-2xl transition-colors hover:bg-[#d64f00] mt-2 shadow-md"
            >
              Terminer la sélection
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          🔥 BOUTON DE DÉPLOIEMENT TACTILE 3D (AVEC PROFONDEUR, GLOW ET APPUYABLE)
          ========================================================================= */}
      {selectedCount > 0 && (
        <div className="pt-6 pb-2">
          <button
            onClick={applyConfig}
            disabled={isSaving}
            className={`w-full bg-gradient-to-b from-[#ff8e38] via-[#ff751f] to-[#d64f00] text-white py-5 px-8 rounded-3xl font-black text-xl uppercase tracking-[0.2em] transform transition-all duration-75 border-b-[6px] border-[#912d00] border-t border-t-white/30 hover:shadow-[0_25px_55px_rgba(255,117,31,0.45)] shadow-[0_12px_30px_rgba(255,117,31,0.3)] flex items-center justify-center active:translate-y-[6px] active:border-b-[0px] ${
              isSaving ? 'opacity-60 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
            }`}
          >
            {isSaving ? "Déploiement..." : "Déployer"}
          </button>
        </div>
      )}
    </div>
  );
}