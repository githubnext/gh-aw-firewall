/**
 * Command handler for `awf preload` subcommand
 *
 * Pre-downloads (pulls) container images to the local Docker cache,
 * ensuring faster startup when running `awf` commands.
 */

import execa from 'execa';
import { logger } from '../logger';

/**
 * Options for the preload command
 */
export interface PreloadCommandOptions {
  /** Container image registry */
  imageRegistry: string;
  /** Container image tag */
  imageTag: string;
}

/**
 * Returns the list of container images used by the firewall
 *
 * @param registry - Container image registry
 * @param tag - Container image tag
 * @returns Array of fully-qualified image names
 */
export function getFirewallImages(registry: string, tag: string): string[] {
  return [
    `${registry}/squid:${tag}`,
    `${registry}/agent:${tag}`,
  ];
}

/**
 * Pulls a single Docker image
 *
 * @param image - Fully-qualified image name to pull
 * @returns Promise that resolves when the image is pulled
 */
async function pullImage(image: string): Promise<void> {
  logger.info(`Pulling image: ${image}`);
  try {
    await execa('docker', ['pull', image], {
      stdio: 'inherit',
    });
    logger.success(`Successfully pulled: ${image}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to pull image ${image}: ${message}`);
  }
}

/**
 * Main handler for the `awf preload` subcommand
 *
 * Pre-downloads all container images used by the firewall to the local Docker cache.
 *
 * @param options - Command options
 */
export async function preloadCommand(options: PreloadCommandOptions): Promise<void> {
  const images = getFirewallImages(options.imageRegistry, options.imageTag);

  logger.info(`Pre-downloading ${images.length} firewall container image(s)...`);

  let hasErrors = false;

  for (const image of images) {
    try {
      await pullImage(image);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      hasErrors = true;
    }
  }

  if (hasErrors) {
    logger.error('Some images failed to download');
    process.exit(1);
  }

  logger.success('All container images pre-downloaded successfully');
}
