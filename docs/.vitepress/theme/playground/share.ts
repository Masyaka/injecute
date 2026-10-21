import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';

/** Playground code travels in the URL hash (`#code=…`), so links work on a static site. */
export function readSharedCode(hash: string): string | undefined {
  const match = /(?:^#|&)code=([^&]+)/.exec(hash);
  if (!match) return undefined;
  return decompressFromEncodedURIComponent(match[1]!) ?? undefined;
}

export function shareUrl(code: string, location: Location): string {
  return `${location.origin}${location.pathname}#code=${compressToEncodedURIComponent(code)}`;
}
