import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

const files = import.meta.glob<{ default: ImageMetadata }>('../assets/products/*.jpg', { eager: true });

export const photos: Record<string, ImageMetadata> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.split('/').pop()!.replace('.jpg', ''), mod.default]),
);

export function photo(slug: string): ImageMetadata {
  const img = photos[slug];
  if (!img) throw new Error(`Missing photo src/assets/products/${slug}.jpg`);
  return img;
}

// Tiny square thumbnail URL for the cart drawer / checkout summary.
export async function thumbUrl(slug: string): Promise<string> {
  const img = await getImage({ src: photo(slug), width: 120, height: 120, format: 'webp', quality: 60, fit: 'cover' });
  return img.src;
}
