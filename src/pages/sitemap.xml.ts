import type { APIRoute } from 'astro';
import { CATEGORY_GROUPS, PRODUCTS } from '../data/catalog';
import { SITE } from '../config';

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL(SITE.url)).href.replace(/\/$/, '');
  const pages = ['/', '/shop/', '/diwali/', '/daisy/', '/bulk-orders/', '/contact/', '/shipping-policy/', '/refund-policy/', '/privacy-policy/', '/terms/'];
  const paths = [...pages, ...CATEGORY_GROUPS.map((g) => `/collections/${g.id}/`), ...PRODUCTS.map((p) => `/product/${p.slug}/`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
