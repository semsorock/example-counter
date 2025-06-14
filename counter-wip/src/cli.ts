// This file is part of midnightntwrk/example-counter.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { type Resource } from '@midnight-ntwrk/wallet';
import { type Wallet } from '@midnight-ntwrk/wallet-api';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { type StartedDockerComposeEnvironment, type DockerComposeEnvironment } from 'testcontainers';
import { type CounterProviders, type DeployedCounterContract } from './common-types';
import { type Config, StandaloneConfig } from './config';
import * as api from './api';

let logger: Logger;

/**
 * This seed gives access to tokens minted in the genesis block of a local development node - only
 * used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const MAIN_LOOP_QUESTION = `
You can do one of the following:
  1. Increment
  2. Display current counter value
  3. Exit
Which would you like to do? `;

const join = async (providers: CounterProviders, rli: Interface): Promise<DeployedCounterContract> => {
  const contractAddress = '020027a98c5c648ee9260c9d476b275f2c806a3a29f5e3b1d213c32d09e038d5c239';
  return await api.joinContract(providers, contractAddress);
};

const deployOrJoin = async (providers: CounterProviders, rli: Interface): Promise<DeployedCounterContract | null> => {
  return await join(providers, rli);
};

const mainLoop = async (providers: CounterProviders, rli: Interface): Promise<void> => {
  const counterContract = await deployOrJoin(providers, rli);
  if (counterContract === null) {
    return;
  }
  while (true) {
    const choice = await rli.question(MAIN_LOOP_QUESTION);
    switch (choice) {
      case '1':
        await api.increment(counterContract);
        break;
      case '2':
        await api.displayCounterValue(providers, counterContract);
        break;
      case '3':
        logger.info('Exiting...');
        return;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

const buildWallet = async (config: Config, rli: Interface): Promise<(Wallet & Resource) | null> => {
  const seed = 'a664514b5774b0a4567dcb700738c853be593590606ea471fe1146100d2f666c';
  return await api.buildWalletAndWaitForFunds(config, seed, '');
};

const mapContainerPort = (env: StartedDockerComposeEnvironment, url: string, containerName: string) => {
  const mappedUrl = new URL(url);
  const container = env.getContainer(containerName);

  mappedUrl.port = String(container.getFirstMappedPort());

  return mappedUrl.toString().replace(/\/+$/, '');
};

export const run = async (config: Config, _logger: Logger, dockerEnv?: DockerComposeEnvironment): Promise<void> => {
  logger = _logger;
  api.setLogger(_logger);
  const rli = createInterface({ input, output, terminal: true });
  let env;
  if (dockerEnv !== undefined) {
    env = await dockerEnv.up();

    if (config instanceof StandaloneConfig) {
      config.indexer = mapContainerPort(env, config.indexer, 'counter-indexer');
      config.indexerWS = mapContainerPort(env, config.indexerWS, 'counter-indexer');
      config.node = mapContainerPort(env, config.node, 'counter-node');
      config.proofServer = mapContainerPort(env, config.proofServer, 'counter-proof-server');
    }
  }
  const wallet = await buildWallet(config, rli);
  try {
    if (wallet !== null) {
      const providers = await api.configureProviders(wallet, config);
      await mainLoop(providers, rli);
    }
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Found error '${e.message}'`);
      logger.info('Exiting...');
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logger.error(`Error closing readline interface: ${e}`);
    } finally {
      try {
        if (wallet !== null) {
          await wallet.close();
        }
      } catch (e) {
        logger.error(`Error closing wallet: ${e}`);
      } finally {
        try {
          if (env !== undefined) {
            await env.down();
            logger.info('Goodbye');
          }
        } catch (e) {
          logger.error(`Error shutting down docker environment: ${e}`);
        }
      }
    }
  }
};
