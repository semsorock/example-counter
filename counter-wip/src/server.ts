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

import { createLogger } from './logger-utils.js';
import { TestnetRemoteConfig } from './config.js';
import * as api from './api.js';
import { type Resource } from '@midnight-ntwrk/wallet';
import { type Wallet } from '@midnight-ntwrk/wallet-api';
import { type Logger } from 'pino';
import { type CounterProviders, type DeployedCounterContract } from './common-types.js';
import express, { type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const logger = await createLogger('logs/server.log');
const app = express();
const port = 3011;

// Add JSON body parser middleware
app.use(express.json());


const MASUMI_PAYMENT_SERVICE_URL='https://localhost:3001/api/v1'
const MASUMI_PAYMENT_API_KEY='masumi-payment-admin-zjcibanusu84ocewzqlk3u41'


const NETWORK = 'Preprod';
const jobs = new Map();

const ASCII_NUMBERS: Record<string, string[]> = {
  '0': [
    '  ████  ',
    ' ██  ██ ',
    '██    ██',
    '██    ██',
    ' ██  ██ ',
    '  ████  '
  ],
  '1': [
    '   ██   ',
    '  ███   ',
    '   ██   ',
    '   ██   ',
    '   ██   ',
    '  ████  '
  ],
  '2': [
    ' ██████ ',
    '██    ██',
    '     ██ ',
    '   ██   ',
    ' ██     ',
    '████████'
  ],
  '3': [
    ' ██████ ',
    '██    ██',
    '    ███ ',
    '    ███ ',
    '██    ██',
    ' ██████ '
  ],
  '4': [
    '██    ██',
    '██    ██',
    '████████',
    '     ██ ',
    '     ██ ',
    '     ██ '
  ],
  '5': [
    '████████',
    '██      ',
    '███████ ',
    '      ██',
    '██    ██',
    ' ██████ '
  ],
  '6': [
    ' ██████ ',
    '██      ',
    '███████ ',
    '██    ██',
    '██    ██',
    ' ██████ '
  ],
  '7': [
    '████████',
    '     ██ ',
    '    ██  ',
    '   ██   ',
    '  ██    ',
    ' ██     '
  ],
  '8': [
    ' ██████ ',
    '██    ██',
    ' ██████ ',
    '██    ██',
    '██    ██',
    ' ██████ '
  ],
  '9': [
    ' ██████ ',
    '██    ██',
    '██    ██',
    ' ███████',
    '      ██',
    ' ██████ '
  ]
};

const numberToAscii = (num: number): string => {
  const digits = num.toString().split('');
  const lines: string[] = [];
  
  // Initialize lines array with empty strings
  for (let i = 0; i < 6; i++) {
    lines[i] = '';
  }
  
  // Build each line of the ASCII art
  digits.forEach((digit, index) => {
    const asciiDigit = ASCII_NUMBERS[digit];
    if (asciiDigit) {
      asciiDigit.forEach((line, lineIndex) => {
        lines[lineIndex] += line + (index < digits.length - 1 ? '  ' : '');
      });
    }
  });
  
  return lines.join('\n');
};

const buildWallet = async (config: TestnetRemoteConfig): Promise<(Wallet & Resource) | null> => {
  const seed = 'a664514b5774b0a4567dcb700738c853be593590606ea471fe1146100d2f666c';
  return await api.buildWalletAndWaitForFunds(config, seed, '');
};

const joinContract = async (providers: CounterProviders): Promise<DeployedCounterContract> => {
  const contractAddress = '020027a98c5c648ee9260c9d476b275f2c806a3a29f5e3b1d213c32d09e038d5c239';
  return await api.joinContract(providers, contractAddress);
};

const logLedgerState = async (providers: CounterProviders, counterContract: DeployedCounterContract) => {
  try {
    const { counterValue } = await api.displayCounterValue(providers, counterContract);
    if (counterValue !== null) {
      const asciiArt = numberToAscii(Number(counterValue));
      logger.info('\n' + asciiArt + '\n');
    }
  } catch (error) {
    logger.error('Error logging ledger state:', error);
  }
};

const runServer = async () => {
  const config = new TestnetRemoteConfig();
  api.setLogger(logger);
  
  logger.info('Starting server and connecting to testnet-remote...');
  
  const wallet = await buildWallet(config);
  if (wallet === null) {
    logger.error('Failed to build wallet');
    return;
  }

  try {
    const providers = await api.configureProviders(wallet, config);
    const counterContract = await joinContract(providers);
    
    logger.info('Successfully connected to testnet-remote and joined contract');
    
    // Set up interval to log ledger state every 5 seconds
    const interval = setInterval(async () => {
      await logLedgerState(providers, counterContract);
    }, 5000);

    // Set up HTTP endpoints
    app.post('/start_job_old', async (req: Request, res: Response) => {
      try {
        const { input_data } = req.body;
        
        if (!input_data || !Array.isArray(input_data)) {
          return res.status(400).json({ 
            success: false, 
            error: 'Invalid request body: input_data must be an array' 
          });
        }

        const taskInput = input_data.find(item => item.key === 'task');
        if (!taskInput || taskInput.value !== 'increment') {
          return res.status(400).json({ 
            success: false, 
            error: 'Invalid task value: must be "increment"' 
          });
        }

        const result = await api.increment(counterContract);
        logger.info(`Incremented counter via HTTP. Transaction ID: ${result.txId}`);
        res.json({ job_id: result.txId});
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('Error incrementing counter:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
        res.status(500).json({ 
          success: false, 
          error: 'Failed to increment counter',
          details: errorMessage
        });
      }
    });

    const inputHash = uuidv4(); // Simulated input hash
    const blockchainIdentifier = 'Cardano';

    app.post('/start_job', async (req: Request, res: Response) => {
      const inputData = req.body.input_data;
      if (!Array.isArray(inputData)) {
        return res.status(400).json({ error: 'input_data must be an array' });
      }

      const task = inputData.find((entry) => entry.key === 'task')?.value;
      if (task !== 'increment') {
        return res.status(400).json({ error: 'Unsupported task' });
      }

      const jobId = uuidv4();
      const paymentId = uuidv4();
      const now = Math.floor(Date.now() / 1000); // Current time in Unix seconds
    
      const unlockTime = now + 600; // 10 minutes later
      const externalDisputeUnlockTime = now + 1800; // 30 minutes later
      const submitResultTime = now + 1200; // 20 minutes later

      jobs.set(jobId, { status: 'awaiting_payment', result: null });

      res.json({
        job_id: jobId,
        payment_id: paymentId,
        inputHash,
        blockchainIdentifier,
        unlockTime: unlockTime.toString(),
        externalDisputeUnlockTime: externalDisputeUnlockTime.toString(),
        submitResultTime: submitResultTime.toString()
      });

      try {
        let confirmed = false;
        const start = Date.now();
        const timeout = 120000;
        while (!confirmed && Date.now() - start < timeout) {
          logger.info('in while loop');
          await new Promise((r) => setTimeout(r, 5000));
          const check = await axios.get(`${MASUMI_PAYMENT_SERVICE_URL}/payment`, {
            params: { paymentId },
            headers: { token: MASUMI_PAYMENT_API_KEY },
          });
          
          logger.info('after payment check');
          logger.info(`check: ${check}`);

          if (check.data?.data?.status === 'Success') {
            confirmed = true;
          }
        }

        if (!confirmed) {
          jobs.set(jobId, { status: 'failed', result: 'Payment timeout' });
          logger.info('payment timeout. quiting');
          return;
        }

        jobs.set(jobId, { status: 'running' });

        logger.info('before increment');
        const result = await api.increment(counterContract);
        logger.info(`after increment: ${result}`);

        jobs.set(jobId, { status: 'completed', result: result.txId });
      } catch (err) {
        logger.error(`error: ${err}`);
        jobs.set(jobId, { status: 'failed', result: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    app.get('/status', (req: Request, res: Response) => {
      const jobId = req.query.job_id as string;
      if (!jobId || !jobs.has(jobId)) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const job = jobs.get(jobId);
      res.json({
        job_id: jobId,
        status: job.status,
        result: job.result,
      });
    });

    app.get('/availability', (req: Request, res: Response) => {
      res.json({
        status: 'available',
        uptime: Math.floor(process.uptime()),
        message: 'Midnight Counter Agent is running',
      });
    });

    app.get('/input_schema', (req: Request, res: Response) => {
      res.json({
        input_data: [
          {
            key: 'task',
            value: {
              type: 'string',
              enum: ['increment'],
            },
          },
        ],
      });
    });

    // Start HTTP server
    app.listen(port, () => {
      logger.info(`HTTP server listening at http://localhost:${port}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down server...');
      clearInterval(interval);
      await wallet.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Error in server:', error);
    await wallet.close();
    process.exit(1);
  }
};

runServer().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
}); 
