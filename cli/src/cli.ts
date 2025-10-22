#!/usr/bin/env node

import { cli } from './index.js'

void cli.runExit(process.argv.slice(2))
