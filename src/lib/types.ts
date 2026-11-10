// Types partagés entre tous les écrans de l'app.
// (Nommé AppScreen pour éviter la collision avec l'interface Screen du navigateur.)

export interface AppScreen {
  id: string;
  configuration_id: string | null;
  last_ping: string | null;
  pos_x: number;
  pos_y: number;
  total_cols: number;
  total_rows: number;
  video_url: string | null;
  audio_url: string | null;
  user_id?: string | null;
  // Champs remontés par le lecteur installé sur l'écran (diagnostic)
  group_id?: string | null;
  rotation?: number | null;
  opening_time?: string | null;
  closing_time?: string | null;
  latest_version_code?: number | null;
  apk_url?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  // Commandes à distance et infos appareil (migration 20261110_maintenance.sql)
  command?: string | null;
  command_id?: string | null;
  command_at?: string | null;
  command_ack?: string | null;
  command_ack_at?: string | null;
  player_version?: string | null;
  device_model?: string | null;
  booted_at?: string | null;
}

export type ScreenEventKind = 'outage' | 'boot' | 'error' | 'command' | 'content' | 'assign';

export interface ScreenEvent {
  id: number;
  screen_id: string;
  kind: ScreenEventKind;
  message: string | null;
  started_at: string | null;
  created_at: string;
}

export type ScreenCommand = 'reload' | 'clear_cache';

export interface Profile {
  id: string;
  email: string | null;
  role: 'admin' | 'user';
}

export interface Group {
  id: string;
  name: string;
  image_url: string | null;
  open_time?: string | null;
  close_time?: string | null;
  user_id?: string | null;
}

export interface Configuration {
  id: string;
  group_id: string;
  name: string;
  format: string;
}

export interface Album {
  id: string;
  name: string;
  group_id?: string | null;
  created_at?: string;
}

export interface VideoFile {
  id: string;
  album_id: string;
  name: string;
  url: string;
  size?: string | null;
  thumbnail?: string | null;
  created_at?: string;
}

export type GroupMode = 'global' | 'per-screen';
