import icons from '../data/icons.json';

/** Names of the Big Jo’s line icons in src/data/icons.json. */
export type IconName = Exclude<keyof typeof icons, '$comment'>;

export function iconSvg(name: IconName): string {
  return icons[name].svg;
}
