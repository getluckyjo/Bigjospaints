/**
 * Real photos from Unsplash, chosen by the owner (11 Oct 2026), free to use under the Unsplash License
 * (https://unsplash.com/license). We credit each photographer next to the photo. The files were
 * downloaded from Unsplash's image service; README.md lists the exact URLs. Only real photographs here:
 * no renders or AI images, and no Unsplash+ photos (they need a paid licence).
 */
import type { ImageMetadata } from 'astro';
import apartment from '../assets/photos/apartment.jpg';
import bedroomMirror from '../assets/photos/bedroom-mirror.jpg';
import greenCouch from '../assets/photos/green-couch.jpg';
import leatherSofa from '../assets/photos/leather-sofa.jpg';
import readingCorner from '../assets/photos/reading-corner.jpg';
import swatches from '../assets/photos/swatches.jpg';

export interface Photo {
  src: ImageMetadata;
  alt: string;
  photographer: string;
  /** The photo's page on Unsplash. */
  page: string;
}

export const photos = {
  greenCouch: {
    src: greenCouch,
    alt: 'A sunny loft living room with a green sofa, a wooden coffee table, a cream armchair, a tall plant by the windows and a green velvet chair at the far end.',
    photographer: 'Evan Wise',
    page: 'https://unsplash.com/photos/a-living-room-with-a-green-couch-and-a-coffee-table-jZkFVycn3FQ',
  },
  apartment: {
    src: apartment,
    alt: 'A bright living room with plain white walls: a grey loveseat under the window, white built-in shelves full of books and plants, a wooden coffee table and chair, and a hanging plant.',
    photographer: 'Patrick Perkins',
    page: 'https://unsplash.com/photos/gray-fabric-loveseat-near-brown-wooden-table-3wylDrjxH-E',
  },
  bedroomMirror: {
    src: bedroomMirror,
    alt: 'A white bedroom wall with a round wooden mirror above a white and oak sideboard, a tall leafy plant, and the end of a bed with a grey throw.',
    photographer: 'Minh Pham',
    page: 'https://unsplash.com/photos/white-wooden-dresser-with-mirror-7pCFUybP_P8',
  },
  swatches: {
    src: swatches,
    alt: 'A wall of paint colour cards in a shop, running from greens and teals to blues, purples and pinks.',
    photographer: 'Clay Banks',
    page: 'https://unsplash.com/photos/white-blue-red-and-yellow-concrete-building-T2KOfVwW3g0',
  },
  leatherSofa: {
    src: leatherSofa,
    alt: 'A tan leather sofa against a tall warm-white wall with two framed prints, a tripod floor lamp and a snake plant.',
    photographer: 'Michael Oxendine',
    page: 'https://unsplash.com/photos/living-room-with-brown-leather-sofa-GHCVUtBECuY',
  },
  readingCorner: {
    src: readingCorner,
    alt: 'A living room corner with wooden shelves of plants and prints, a vintage radio on a sideboard, a grey armchair with a patterned cushion and a floor lamp.',
    photographer: 'Kate Darmody',
    page: 'https://unsplash.com/photos/white-and-brown-table-lamp-on-brown-wooden-table-TDIdPmW2P9k',
  },
} satisfies Record<string, Photo>;
