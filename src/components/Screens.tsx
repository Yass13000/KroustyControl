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
  image_url: string | null;
}

interface ScreensProps {
  availableScreens: Screen[];
  availableGroups: Group[];
  sbClient: any;
  openFolders: Record<string, boolean>;
  setOpenFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export default function Screens({
  availableScreens = [],
  availableGroups = [],
  sbClient,
  openFolders,
  setOpenFolders
}: ScreensProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupFormat, setNewGroupFormat] = useState('1x1');
  const [newGroupImageUrl, setNewGroupImageUrl] = useState(''); 
  const [uploadingImage, setUploadingImage] = useState(false); 
  const [currentFilter, setCurrentFilter] = useState<'all' | 'unassigned'>('all');

  const [b2DownloadToken, setB2DownloadToken] = useState('');

  const [selectedGroupForConfig, setSelectedGroupForConfig] = useState<Group | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{
    groupId: string;
    format: string;
    x: number;
    y: number;
    displayNum: number;
  } | null>(null);

  const now = new Date().getTime();

  const B2_KEY_ID = "00382696474bd910000000001"; 
  const B2_APPLICATION_KEY = "K003CXTldNwALY4kB2nrOSptF/Gleuo";
  const B2_BUCKET_ID = "a872d62946a4a7149bed0911";

  const isScreenOnline = (lastPing: string | null) => {
    if (!lastPing) return false;
    return (now - new Date(lastPing).getTime()) / 1000 < 45;
  };

  const toggleCreateForm = () => {
    setShowCreateForm(prev => !prev);
  };

  const fetchB2Token = async () => {
    try {
      const credentials = btoa(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`);
      const authRes = await fetch(`https://corsproxy.io/?${encodeURIComponent("https://api.backblazeb2.com/b2api/v2/b2_authorize_account")}`, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${credentials}` }
      });
      if (!authRes.ok) return;
      const authData = await authRes.json();

      const tokenRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(`${authData.apiUrl}/b2api/v2/b2_get_download_authorization`)}`, {
        method: 'POST',
        headers: { 'Authorization': authData.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: B2_BUCKET_ID, fileNamePrefix: "", validDurationInSeconds: 7200 })
      });
      if (!tokenRes.ok) return;
      const tokenData = await tokenRes.json();
      setB2DownloadToken(tokenData.authorizationToken);
    } catch (err) {
      console.error("Erreur d'antenne vidéo:", err);
    }
  };

  useEffect(() => {
    fetchB2Token();
  }, []);

  const getAuthenticatedUrl = (url: string) => {
    if (!url) return '';
    if (url.includes("backblazeb2.com") && !url.includes("Authorization=") && b2DownloadToken) {
      return `${url}?Authorization=${b2DownloadToken}`;
    }
    return url;
  };

  const uploadRestaurantImage = async (file: File, pathPrefix: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const filePath = `${pathPrefix}-${Date.now()}.${fileExt}`;
    
    const { error: uploadError } = await sbClient.storage
      .from('medias')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = sbClient.storage
      .from('medias')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleCreateImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const publicUrl = await uploadRestaurantImage(file, 'new-restaurant');
      setNewGroupImageUrl(publicUrl);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingImage(false);
    }
  };

  const handlePopupImageChange = async (e: React.ChangeEvent<HTMLInputElement>, groupId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const publicUrl = await uploadRestaurantImage(file, `group-${groupId}`);
      await sbClient.from('groups').update({ image_url: publicUrl }).eq('id', groupId);
      setSelectedGroupForConfig(prev => prev ? { ...prev, image_url: publicUrl } : null);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingImage(false);
    }
  };

  const submitNewGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await sbClient.from('groups').insert([{ 
      name, 
      format: newGroupFormat,
      image_url: newGroupImageUrl.trim() || null 
    }]);
    setNewGroupName('');
    setNewGroupImageUrl('');
    setShowCreateForm(false);
  };

  const deleteGroup = async (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Supprimer ce restaurant ?")) {
      await sbClient.from('groups').delete().eq('id', groupId);
      if (selectedGroupForConfig?.id === groupId) {
        setSelectedGroupForConfig(null);
      }
    }
  };

  const deleteScreen = async (screenId: string) => {
    if (confirm("Supprimer cet appareil ?")) {
      await sbClient.from('screens_config').delete().eq('id', screenId);
    }
  };

  const changeGroupFormat = async (groupId: string, nextFormat: string) => {
    try {
      await sbClient.from('groups').update({ format: nextFormat }).eq('id', groupId);
      if (selectedGroupForConfig && selectedGroupForConfig.id === groupId) {
        setSelectedGroupForConfig(prev => prev ? { ...prev, format: nextFormat } : null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const resetScreen = async (screenId: string) => {
    await sbClient.from('screens_config')
      .update({
        group_id: null,
        total_cols: 1,
        total_rows: 1,
        pos_x: 0,
        pos_y: 0,
        video_url: '',
        audio_url: ''
      })
      .eq('id', screenId);
  };

  const openAssignModal = (groupId: string, format: string, x: number, y: number, displayNum: number) => {
    setAssignTarget({ groupId, format, x, y, displayNum });
    setShowAssignModal(true);
  };

  const submitAssign = async (screenId: string) => {
    if (!assignTarget) return;
    const { groupId, format, x, y } = assignTarget;
    const [rows, cols] = format.split('x').map(Number);
    
    setShowAssignModal(false);
    setAssignTarget(null);

    await sbClient.from('screens_config')
      .update({
        group_id: groupId,
        pos_x: x,
        pos_y: y,
        total_cols: cols,
        total_rows: rows
      })
      .eq('id', screenId);
  };

  const filterUnassigned = () => {
    setCurrentFilter(prev => prev === 'unassigned' ? 'all' : 'unassigned');
  };

  const filteredGroups = (availableGroups || []).filter(g =>
    g && g.name && g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const unassignedScreens = (availableScreens || []).filter(s => s && !s.group_id);

  let popupGridSlots: React.ReactNode[] = [];
  let currentConfigGroupInfo: Group | null = null;
  let screensInActiveConfigGroup: Screen[] = [];

  if (selectedGroupForConfig) {
    currentConfigGroupInfo = (availableGroups || []).find(g => g && g.id === selectedGroupForConfig.id) || selectedGroupForConfig;
    screensInActiveConfigGroup = (availableScreens || []).filter(s => s && s.group_id === currentConfigGroupInfo?.id);
    
    const [rows, cols] = currentConfigGroupInfo.format.split('x').map(Number);
    let slotCounter = 1;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const currentSlot = slotCounter;
        const matchedScreen = screensInActiveConfigGroup.find(s => s.pos_x === x && s.pos_y === y);
        const currentX = x;
        const currentY = y;

        if (matchedScreen) {
          const fileName = matchedScreen.video_url ? decodeURIComponent(matchedScreen.video_url.split('/').pop()?.split('?')[0] || '') : '';
          const signedVideoUrl = getAuthenticatedUrl(matchedScreen.video_url || '');

          popupGridSlots.push(
            <div key={matchedScreen.id} className="relative bg-slate-900 border border-white/10 rounded-2xl flex flex-col justify-between h-28 overflow-hidden group/slot">
              
              {/* CORRECTION DE SÉCURITÉ : Ne s'affiche que si le token d'authentification B2 est prêt */}
              {matchedScreen.video_url && b2DownloadToken && signedVideoUrl && (
                <video
                  key={signedVideoUrl} 
                  src={signedVideoUrl}
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="auto"
                  className="absolute inset-0 w-full h-full object-cover opacity-45 z-0 pointer-events-none"
                />
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/70 z-10 pointer-events-none" />

              <div className="z-20 p-2 flex flex-col justify-between h-full w-full">
                <div className="flex justify-between items-center">
                  <span className="text-[8px] font-black text-white/60 font-mono">POS {currentSlot}</span>
                  <div className="flex items-center gap-1">
                    {matchedScreen.video_url && <span className="text-[7px] font-black text-[#ff751f] bg-black/50 px-1 rounded font-mono tracking-wider">LIVE</span>}
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isScreenOnline(matchedScreen.last_ping) ? 'bg-[#34C759] pulse-green' : 'bg-white/20'}`}></div>
                  </div>
                </div>

                <div className="text-center my-0.5 min-w-0">
                  <p className="font-black text-[10px] text-[#ff751f] truncate drop-shadow">{matchedScreen.id}</p>
                  {fileName && <p className="text-[7px] text-white/50 font-medium truncate px-0.5 mt-0.5 font-mono">{fileName}</p>}
                </div>

                <button
                  onClick={() => resetScreen(matchedScreen.id)}
                  className="w-full text-center text-[8px] font-black text-white/80 bg-white/10 hover:bg-red-600/80 border border-white/5 py-1 rounded-lg transition-colors uppercase tracking-wider"
                >
                  Retirer
                </button>
              </div>
            </div>
          );
        } else {
          popupGridSlots.push(
            <div
              key={`empty-slot-${y}-${x}`}
              onClick={() => openAssignModal(currentConfigGroupInfo!.id, currentConfigGroupInfo!.format, currentX, currentY, currentSlot)}
              className="border border-dashed border-[#e3dad0] hover:border-[#ff751f]/30 bg-[#faf6f0]/30 hover:bg-[#faf6f0]/70 rounded-2xl flex flex-col items-center justify-center h-28 cursor-pointer text-[#7c6258] hover:text-[#ff751f] transition-all p-1 text-center"
            >
              <span className="text-[8px] font-bold text-[#7c6258]/60">POS {currentSlot}</span>
              <span className="text-[9px] font-black text-[#ff751f] mt-0.5 whitespace-nowrap">+ Assigner</span>
            </div>
          );
        }
        slotCounter++;
      }
    }
  }

  return (
    <div className="space-y-5 page-content">
      <div className="flex gap-2.5 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un restaurant..."
          className="glass-input w-full min-w-0 rounded-2xl p-4 text-xs placeholder-[#e3dad0]/60 outline-none font-semibold shadow-inner focus:ring-1 focus:ring-[#ff751f]/10"
        />
        <button
          onClick={toggleCreateForm}
          className="px-5 py-4 bg-gradient-to-r from-[#ff751f] to-[#b74b1b] text-white rounded-2xl text-xs font-black shadow-md shadow-[#ff751f]/20 whitespace-nowrap btn-glow flex-shrink-0 flex items-center justify-center text-center"
        >
          + Restaurant
        </button>
      </div>

      {showCreateForm && (
        <div className="glass-card p-4 shadow-xl border border-[#f2ede4] bg-white/50 flex flex-col gap-3.5 animate-in fade-in duration-200 rounded-3xl">
          <div className="flex items-center gap-2.5 w-full">
            <label className="relative w-10 h-10 rounded-xl border border-dashed border-[#e3dad0] hover:border-[#ff751f]/40 bg-[#faf6f0] flex items-center justify-center cursor-pointer flex-shrink-0 overflow-hidden shadow-inner mt-1 transition-colors">
              {uploadingImage ? (
                <div className="w-3 h-3 border-2 border-[#e3dad0] border-t-[#ff751f] rounded-full animate-spin"></div>
              ) : newGroupImageUrl ? (
                <img src={newGroupImageUrl} className="w-full h-full object-cover" alt="" />
              ) : (
                <img src="/bibliotheque.svg" className="w-5 h-5 object-contain opacity-40" alt="" />
              )}
              <input type="file" accept="image/*" onChange={handleCreateImageUpload} className="hidden" />
            </label>

            <select
              value={newGroupFormat}
              onChange={(e) => setNewGroupFormat(e.target.value)}
              className="w-auto px-2 h-10 bg-white border border-[#e3dad0] rounded-xl text-xs font-black text-[#b74b1b] cursor-pointer focus:border-[#ff751f]/50 transition-all text-center outline-none font-mono"
            >
              <option value="1x1">1x1</option>
              <option value="1x2">1x2</option>
              <option value="1x3">1x3</option>
              <option value="1x4">1x4</option>
              <option value="2x2">2x2</option>
            </select>

            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Nom du restaurant"
              className="flex-1 h-10 bg-white border border-[#e3dad0] rounded-xl p-3 text-xs text-[#b74b1b] placeholder-[#e3dad0] outline-none font-semibold shadow-inner"
            />
          </div>
          
          <div className="flex justify-end gap-2">
            <button
              onClick={toggleCreateForm}
              className="px-4 py-1.5 text-xs font-bold text-[#7c6258] bg-[#faf6f0] hover:bg-[#e3dad0]/30 rounded-xl transition-all"
            >
              Annuler
            </button>
            <button
              onClick={submitNewGroup}
              className="px-5 py-1.5 text-xs font-bold text-white bg-[#ff751f] hover:bg-[#b74b1b] rounded-xl shadow-md transition-all active:scale-95"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center px-1">
        <span className="text-[10px] font-bold text-[#7c6258] uppercase tracking-wider">Établissements actifs</span>
        <button
          onClick={filterUnassigned}
          className={`btn-action px-3 py-2 rounded-full border shadow-md text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all flex-shrink-0 ${
            currentFilter === 'unassigned'
              ? "bg-[#ff751f]/10 border-[#ff751f]/30 text-[#ff751f] shadow-[#ff751f]/5"
              : "bg-white border-[#e3dad0] text-[#7c6258] hover:text-[#ff751f]"
          }`}
        >
          <span>En attente</span>
          <span className="bg-[#faf6f0] border border-[#e3dad0] text-[#b74b1b] px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0">
            {unassignedScreens.length}
          </span>
        </button>
      </div>

      <div className="liveGridContainer">
        {currentFilter === 'unassigned' ? (
          unassignedScreens.length === 0 ? (
            <div className="glass-card p-8 text-center border border-[#f2ede4] bg-[#faf6f0]/20 rounded-2xl">
              <p className="text-xs text-[#7c6258] font-medium">Aucun écran en attente.</p>
            </div>
          ) : (
            <div className="glass-card p-5 space-y-3 shadow-xl rounded-2xl border border-[#e3dad0] bg-white/40">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {unassignedScreens.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-[#faf6f0]/70 rounded-xl border border-[#e3dad0] gap-4">
                    <div className="flex items-center gap-2 overflow-hidden min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isScreenOnline(s.last_ping) ? 'bg-[#34C759] pulse-green' : 'bg-[#7c6258]/50'}`}></div>
                      <span className="font-bold text-xs text-[#b74b1b] truncate">{s.id}</span>
                    </div>
                    <button
                      onClick={() => deleteScreen(s.id)}
                      className="text-[9px] font-bold text-red-500 bg-red-500/5 px-2.5 py-1.5 rounded-lg border border-red-500/10 hover:bg-red-500 hover:text-white transition-colors"
                    >
                      Supprimer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : filteredGroups.length === 0 ? (
          <div className="glass-card p-8 text-center border border-[#f2ede4] bg-[#faf6f0]/20 rounded-2xl">
            <p className="text-xs text-[#7c6258] font-medium">Aucun restaurant trouvé.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {filteredGroups.map(group => {
              const screensInGroup = (availableScreens || []).filter(s => s && s.group_id === group.id);
              let groupOnlineCount = 0;
              screensInGroup.forEach(s => {
                if (s && isScreenOnline(s.last_ping)) groupOnlineCount++;
              });

              return (
                <div
                  key={group.id}
                  onClick={() => setSelectedGroupForConfig(group)}
                  className="relative border border-[#f2ede4] hover:border-[#ff751f]/50 rounded-3xl p-4 flex flex-col justify-between items-center text-center shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer select-none h-40 overflow-hidden bg-slate-100 group"
                  style={group.image_url ? { backgroundImage: `url(${group.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                >
                  <div className="absolute inset-0 bg-black/35 group-hover:bg-black/45 transition-colors z-0" />

                  <div className="z-10 w-full flex-1 flex flex-col justify-center items-center text-center">
                    <h3 className="text-sm sm:text-base font-black text-[#ff751f] uppercase tracking-wide text-center max-w-full break-words line-clamp-2 px-1 drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.8)]">
                      {group.name}
                    </h3>
                  </div>

                  <div className="z-10 w-full flex justify-between items-center mt-1.5 pt-2 border-t border-white/15">
                    <div className="flex items-center gap-2 bg-black/40 border border-white/10 px-2.5 py-1 rounded-lg shadow-sm">
                      <span className="h-2 w-2 rounded-full bg-[#34C759] pulse-green"></span>
                      <span className="text-xs font-black text-white tracking-tight">{groupOnlineCount}</span>
                    </div>

                    <span className="text-xs font-black bg-black/40 border border-white/10 text-[#ff751f] px-2.5 py-1 rounded-md tracking-wider font-mono shadow-sm">
                      {group.format}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* POPUP DE CONFIGURATION AVEC INJECTION SYNC */}
      {selectedGroupForConfig && currentConfigGroupInfo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-[#f2ede4] w-full max-w-sm rounded-3xl p-4 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto flex flex-col">
            
            <div className="flex justify-between items-center border-b border-[#faf6f0] pb-3 gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <label className="relative w-10 h-10 rounded-xl border border-dashed border-[#e3dad0] hover:border-[#ff751f]/40 bg-[#faf6f0] flex items-center justify-center cursor-pointer flex-shrink-0 overflow-hidden shadow-inner transition-colors">
                  {uploadingImage ? (
                    <div className="w-3 h-3 border-2 border-[#e3dad0] border-t-[#ff751f] rounded-full animate-spin"></div>
                  ) : currentConfigGroupInfo.image_url ? (
                    <img src={currentConfigGroupInfo.image_url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <img src="/bibliotheque.svg" className="w-5 h-5 object-contain opacity-40" alt="" />
                  )}
                  <input type="file" accept="image/*" disabled={uploadingImage} onChange={(e) => handlePopupImageChange(e, currentConfigGroupInfo!.id)} className="hidden" />
                </label>

                <select
                  value={currentConfigGroupInfo.format}
                  onChange={(e) => changeGroupFormat(currentConfigGroupInfo!.id, e.target.value)}
                  className="w-auto px-2 h-10 bg-[#faf6f0] border border-[#e3dad0] rounded-xl text-xs font-black text-[#b74b1b] cursor-pointer focus:border-[#ff751f]/50 transition-all text-center outline-none font-mono"
                >
                  <option value="1x1">1x1</option>
                  <option value="1x2">1x2</option>
                  <option value="1x3">1x3</option>
                  <option value="1x4">1x4</option>
                  <option value="2x2">2x2</option>
                </select>

                <h4 className="text-xs font-black text-[#b74b1b] uppercase truncate ml-1 flex-1">{currentConfigGroupInfo.name}</h4>
              </div>
              
              <button
                onClick={() => setSelectedGroupForConfig(null)}
                className="bg-[#faf6f0] hover:bg-[#e3dad0]/40 text-[#7c6258] font-bold p-2 text-xs rounded-full transition-all flex-shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              <div 
                className="grid gap-2" 
                style={{ gridTemplateColumns: `repeat(${currentConfigGroupInfo.format.split('x').map(Number)[1]}, minmax(0, 1fr))` }}
              >
                {popupGridSlots}
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#faf6f0]">
              <button
                onClick={(e) => deleteGroup(currentConfigGroupInfo!.id, e)}
                className="w-1/3 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-xl py-2.5 text-[10px] font-black uppercase tracking-wider transition-all border border-red-200/40"
              >
                Supprimer
              </button>
              <button
                onClick={() => setSelectedGroupForConfig(null)}
                className="w-2/3 bg-gradient-to-r from-[#ff751f] to-[#b74b1b] text-white rounded-xl py-2.5 text-[10px] font-black uppercase tracking-wider shadow-md transition-all text-center"
              >
                Appliquer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ASSIGNATION TELEVISION */}
      {showAssignModal && assignTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white border border-[#f2ede4] w-full max-w-xs rounded-3xl p-4 space-y-4 shadow-2xl">
            <div className="space-y-1.5 max-h-[35vh] overflow-y-auto pr-0.5">
              {unassignedScreens.length === 0 ? (
                <p className="text-[10px] text-center text-[#7c6258] py-4 italic">Aucune TV disponible.</p>
              ) : (
                unassignedScreens.map(s => (
                  <button
                    key={s.id}
                    onClick={() => submitAssign(s.id)}
                    className="w-full bg-[#faf6f0]/80 hover:bg-[#ff751f]/10 p-3 rounded-xl border border-[#e3dad0] hover:border-[#ff751f]/35 font-bold text-xs text-[#b74b1b] transition-all flex justify-between items-center"
                  >
                    <span className="truncate">{s.id}</span>
                    <span className="text-[#ff751f] font-black text-xs">Rattacher +</span>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => {
                setShowAssignModal(false);
                setAssignTarget(null);
              }}
              className="w-full bg-[#faf6f0] text-[#7c6258] text-[10px] font-black py-2.5 rounded-xl hover:bg-[#e3dad0]/40 transition-colors uppercase tracking-wider"
            >
              Retour
            </button>
          </div>
        </div>
      )}
    </div>
  );
}