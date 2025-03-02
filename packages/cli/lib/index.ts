#!/usr/bin/env node

/*
 * Copyright (c) 2023 Nango, all rights reserved.
 */

import { Command } from 'commander';
import fs from 'fs';
import chalk from 'chalk';
import figlet from 'figlet';
import path from 'path';
import * as dotenv from 'dotenv';

import { nangoConfigFile, loadSimplifiedConfig } from '@nangohq/shared';
import { init, dryRun, generate, tsc, tscWatch, configWatch, dockerRun, version, deploy } from './sync.js';
import { upgradeAction, NANGO_INTEGRATIONS_LOCATION, verifyNecessaryFiles, printDebug } from './utils.js';
import type { ENV, DeployOptions } from './types.js';

class NangoCommand extends Command {
    override createCommand(name: string) {
        const cmd = new Command(name);
        cmd.option('--auto-confirm', 'Auto confirm yes to all prompts.');
        cmd.option('--debug', 'Run cli in debug mode, outputting verbose logs.');
        cmd.hook('preAction', async function (this: Command, actionCommand: Command) {
            const { debug } = actionCommand.opts();
            if (debug) {
                printDebug('Debug mode enabled');
                if (fs.existsSync('.env')) {
                    printDebug('.env file detected and loaded');
                }
            }

            await upgradeAction(debug);
        });

        return cmd;
    }
}

const program = new NangoCommand();

dotenv.config();

program.name('nango').description(
    `The CLI requires that you set the NANGO_SECRET_KEY_DEV and NANGO_SECRET_KEY_PROD env variables.

In addition for self-Hosting: set the NANGO_HOSTPORT env variable.

Global flag: --auto-confirm - automatically confirm yes to all prompts.

Available environment variables available:

# Recommendation: in a ".env" file in ./nango-integrations.

# Authenticates the CLI (get the keys in the dashboard's Projects Settings).
NANGO_SECRET_KEY_DEV=xxxx-xxx-xxxx
NANGO_SECRET_KEY_PROD=xxxx-xxx-xxxx

# Nango's instance URL (OSS: change to http://localhost:3003 or your instance URL).
NANGO_HOSTPORT=https://api.nango.dev # Default value

# How to handle CLI upgrades ("prompt", "auto" or "ignore").
NANGO_CLI_UPGRADE_MODE=prompt # Default value

# Whether to prompt before deployments.
NANGO_DEPLOY_AUTO_CONFIRM=false # Default value
`
);

program.addHelpText('before', chalk.green(figlet.textSync('Nango CLI')));

program
    .command('version')
    .description('Print the version of the Nango CLI, Nango Worker, and Nango Server.')
    .action(function (this: Command) {
        const { debug } = this.opts();
        version(debug);
    });

program
    .command('init')
    .description('Initialize a new Nango project')
    .action(async function (this: Command) {
        const { debug } = this.opts();
        await init(debug);
    });

program
    .command('generate')
    .description('Generate a new Nango integration')
    .action(async function (this: Command) {
        const { debug } = this.opts();
        await generate(debug);
    });

program
    .command('dryrun')
    .description('Dry run the sync process to help with debugging against an existing connection in cloud.')
    .arguments('sync connection_id')
    .option('-e [environment]', 'The environment to dry run the sync in, defaults to dev.', 'dev')
    .option('-l, --lastSyncDate [lastSyncDate]', 'Optional: last sync date to retrieve records greater than this date')
    .option('-i, --input [input]', 'Optional: input to pass to the action script')
    .action(async function (this: Command, sync: string, connectionId: string) {
        const { autoConfirm, debug, e: environment } = this.opts();
        await verifyNecessaryFiles(autoConfirm, debug);
        dryRun({ ...this.opts(), sync, connectionId }, environment, debug);
    });

program
    .command('dev')
    .description('Watch tsc files while developing. Set --no-compile-interfaces to disable watching the config file')
    .option('--no-compile-interfaces', `Watch the ${nangoConfigFile} and recompile the interfaces on change`, true)
    .action(async function (this: Command) {
        const { compileInterfaces, autoConfirm, debug } = this.opts();
        await verifyNecessaryFiles(autoConfirm, debug, false);

        if (compileInterfaces) {
            configWatch(debug);
        }

        await tscWatch(debug);
    });

program
    .command('deploy')
    .description('Deploy a Nango integration')
    .arguments('environment')
    .option('-v, --version [version]', 'Optional: Set a version of this deployment to tag this integration with. Can be used for rollbacks.')
    .option('-s, --sync [syncName]', 'Optional deploy only this sync name.')
    .option('--no-compile-interfaces', `Don't compile the ${nangoConfigFile}`, true)
    .action(async function (this: Command, environment: string) {
        const options = this.opts();
        (async (options: DeployOptions) => {
            const { debug } = options;
            await deploy({ ...options, env: 'production' as ENV }, environment, debug);
        })(options as DeployOptions);
    });

// Hidden commands //

program
    .command('deploy:local', { hidden: true })
    .alias('dl')
    .description('Deploy a Nango integration to local')
    .arguments('environment')
    .option('-v, --version [version]', 'Optional: Set a version of this deployment to tag this integration with. Can be used for rollbacks.')
    .option('--no-compile-interfaces', `Don't compile the ${nangoConfigFile}`, true)
    .action(async function (this: Command, environment: string) {
        const options = this.opts();
        (async (options: DeployOptions) => {
            await deploy({ ...options, env: 'local' }, environment, options.debug);
        })(options as DeployOptions);
    });

program
    .command('deploy:staging', { hidden: true })
    .alias('ds')
    .description('Deploy a Nango integration to local')
    .arguments('environment')
    .option('-v, --version [version]', 'Optional: Set a version of this deployment to tag this integration with. Can be used for rollbacks.')
    .option('--no-compile-interfaces', `Don't compile the ${nangoConfigFile}`, true)
    .action(async function (this: Command, environment: string) {
        const options = this.opts();
        (async (options: DeployOptions) => {
            await deploy({ ...options, env: 'staging' }, environment, options.debug);
        })(options as DeployOptions);
    });

program
    .command('compile', { hidden: true })
    .description('Compile the integration files to JavaScript')
    .action(async function (this: Command) {
        const { autoConfirm, debug } = this.opts();
        await verifyNecessaryFiles(autoConfirm, debug);
        tsc(debug);
    });

program
    .command('sync:dev', { hidden: true })
    .description('Work locally to develop integration code')
    .option('--no-compile-interfaces', `Watch the ${nangoConfigFile} and recompile the interfaces on change`, true)
    .action(async function (this: Command) {
        const { compileInterfaces, autoConfirm, debug } = this.opts();
        await verifyNecessaryFiles(autoConfirm, debug);
        if (compileInterfaces) {
            configWatch(debug);
        }

        tscWatch(debug);
        await dockerRun(debug);
    });

program
    .command('sync:docker.run', { hidden: true })
    .description('Run the docker container locally')
    .action(async function (this: Command) {
        const { debug } = this.opts();
        await dockerRun(debug);
    });

program
    .command('sync:config.check', { hidden: true })
    .alias('scc')
    .description('Verify the parsed sync config and output the object for verification')
    .action(async function (this: Command) {
        const { autoConfirm } = this.opts();
        await verifyNecessaryFiles(autoConfirm);
        const cwd = process.cwd();
        const config = await loadSimplifiedConfig(path.resolve(cwd, NANGO_INTEGRATIONS_LOCATION));

        console.log(chalk.green(JSON.stringify(config, null, 2)));
    });

program.parse();
