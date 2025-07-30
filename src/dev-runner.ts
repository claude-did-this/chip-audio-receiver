#!/usr/bin/env node

/**
 * Development Runner with Proper Signal Handling
 * 
 * This wrapper ensures that Ctrl+C works properly with ts-node-dev on Windows
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: dev-runner <script-path> [args...]');
  process.exit(1);
}

const scriptPath = args[0];
const scriptArgs = args.slice(1);

// Resolve the script path
const fullScriptPath = path.resolve(scriptPath);

console.log(`Starting development server for: ${fullScriptPath}`);

// Spawn ts-node with the script
const child: ChildProcess = spawn('ts-node', [fullScriptPath, ...scriptArgs], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env }
});

let isExiting = false;

// Handle various exit scenarios
function handleExit(signal?: string) {
  if (isExiting) {
    console.log('\nForce exit requested, terminating immediately...');
    process.exit(1);
  }
  
  isExiting = true;
  console.log(`\nReceived ${signal || 'exit signal'}, shutting down...`);
  
  // Send SIGTERM to child process
  if (child && !child.killed) {
    if (process.platform === 'win32') {
      // On Windows, we need to use taskkill
      spawn('taskkill', ['/pid', child.pid!.toString(), '/f', '/t'], {
        shell: true,
        stdio: 'ignore'
      });
    } else {
      child.kill('SIGTERM');
    }
  }
  
  // Give the child process time to exit gracefully
  setTimeout(() => {
    if (child && !child.killed) {
      console.log('Child process did not exit, forcing...');
      child.kill('SIGKILL');
    }
    process.exit(0);
  }, 5000);
}

// Handle Ctrl+C
process.on('SIGINT', () => handleExit('SIGINT'));

// Handle termination
process.on('SIGTERM', () => handleExit('SIGTERM'));

// Handle Windows Ctrl+Break
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => handleExit('SIGBREAK'));
}

// Handle child process exit
child.on('exit', (code) => {
  if (!isExiting) {
    console.log(`Child process exited with code ${code}`);
    process.exit(code || 0);
  }
});

// Handle errors
child.on('error', (error) => {
  console.error('Failed to start child process:', error);
  process.exit(1);
});