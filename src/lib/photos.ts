/**
 * Real photos from Unsplash, free to use under the Unsplash License (https://unsplash.com/license).
 * We credit each photographer next to the photo. The files were downloaded from images.unsplash.com,
 * resized (and, for the tins, cropped to leave out other paint brands' labels) by Unsplash's image
 * service; README.md lists the exact URLs. Only real photographs here: no renders or AI images.
 */
import type { ImageMetadata } from 'astro';
import diningRoom from '../assets/photos/dining-room.jpg';
import livingRoom from '../assets/photos/living-room.jpg';
import painting from '../assets/photos/painting.jpg';
import testPatches from '../assets/photos/test-patches.jpg';
import tins from '../assets/photos/tins.jpg';

export interface Photo {
  src: ImageMetadata;
  alt: string;
  photographer: string;
  /** The photo's page on Unsplash. */
  page: string;
}

export const photos = {
  diningRoom: {
    src: diningRoom,
    alt: 'A dining room with a deep blue wall, a honey-coloured wooden dresser, a round table with wooden chairs, a table lamp and a plant.',
    photographer: 'Elena Popova',
    page: 'https://unsplash.com/photos/a-dining-room-with-blue-walls-and-a-wooden-table-NlZMsnCzZp0',
  },
  livingRoom: {
    src: livingRoom,
    alt: 'A lounge with dusty pink walls: a black wood stove in a brick alcove, a grey corduroy sofa, a window with white blinds, a woven wall hanging and a trailing plant.',
    photographer: 'Sven Brandsma',
    page: 'https://unsplash.com/photos/cozy-living-room-with-wood-stove-fRx9CBTvL-E',
  },
  painting: {
    src: painting,
    alt: 'Seen over her shoulder, a woman rolls paint onto a pale wall beside a framed poster.',
    photographer: 'Barney Goodman',
    page: 'https://unsplash.com/photos/person-painting-wall-with-roller-Azz07JvM-EA',
  },
  testPatches: {
    src: testPatches,
    alt: 'Test patches of cream, yellow and green paint on a weathered wall beside a teal door, each marked with its colour code.',
    photographer: 'Patrick Federi',
    page: 'https://unsplash.com/photos/paint-swatches-on-a-weathered-wall-with-teal-door-lgflrTGpBvY',
  },
  tins: {
    src: tins,
    alt: 'Open tins of paint seen from above, in cream, apricot, brown, plum, peach and lilac.',
    photographer: 'Elisabeth Arnold',
    page: 'https://unsplash.com/photos/assortment-of-open-paint-cans-with-various-warm-color-paints-uZ1cCiDiQhc',
  },
} satisfies Record<string, Photo>;
