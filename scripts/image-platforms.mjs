// Read-only Docker Hub manifest inspection. No Docker daemon or account is needed.
import { readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../docker/docker-compose.yml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../db-processor/Dockerfile', import.meta.url), 'utf8');
const images = [...new Set([
  ...[...dockerfile.matchAll(/^FROM (\S+)/gm)].map(match => match[1]),
  ...[...compose.matchAll(/^\s+image: (\S+)/gm)].map(match => match[1]),
])];
const accept = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

async function get(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response;
}

async function main() {
  for (const image of images) {
    const [taggedRepository, digest] = image.split('@');
    const [name, tag] = taggedRepository.split(':');
    const repository = name.includes('/') ? name : `library/${name}`;
    const reference = digest ?? tag ?? 'latest';
    const auth = await (await get(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`)).json();
    const headers = { Authorization: `Bearer ${auth.token}`, Accept: accept };
    const response = await get(`https://registry-1.docker.io/v2/${repository}/manifests/${reference}`, headers);
    const manifest = await response.json();
    let platforms;
    if (manifest.manifests) {
      platforms = manifest.manifests.map(m => `${m.platform.os}/${m.platform.architecture}`).filter(p => !p.includes('unknown'));
    } else {
      const config = await (await get(`https://registry-1.docker.io/v2/${repository}/blobs/${manifest.config.digest}`, headers)).json();
      platforms = [`${config.os}/${config.architecture}`];
    }
    console.log(JSON.stringify({ image, digest: response.headers.get('docker-content-digest'), platforms,
      arm64: platforms.includes('linux/arm64') }));
  }
}

main().catch(error => {
  console.error(`Image inspection failed: ${error.message} (${error.cause?.code ?? 'see network configuration'}). No compatibility result established.`);
  process.exitCode = 1;
});
