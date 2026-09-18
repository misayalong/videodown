import { mountOverlay } from './overlay';
import { platformFor } from '../platforms';

const platform = platformFor(location.hostname);
if (platform) mountOverlay(platform);
