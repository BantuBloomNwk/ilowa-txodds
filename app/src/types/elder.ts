import { ElderRegionKey } from '../theme/colors';

export interface ElderColors {
  primary: string;
  secondary: string;
  glow: string;
}

export interface Elder {
  id: string;
  name: string;
  region: ElderRegionKey;
  regionLabel: string;
  title: string;
  greeting: { [lang: string]: string };
  avatar: number | string | null;
  pattern: string;
  languages: string[];
  wisdom: string[];
  voiceStyle: string;
}
