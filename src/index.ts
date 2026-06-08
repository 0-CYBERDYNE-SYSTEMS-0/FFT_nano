import { handleStartupFailure, main } from './wiring.js';

main().catch(handleStartupFailure);
