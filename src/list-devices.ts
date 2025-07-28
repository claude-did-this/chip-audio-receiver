#!/usr/bin/env node

import { AudioDeviceManager } from './audio-devices';
import { logInfo, logSection, logError } from './logger';

async function listAudioDevices() {
  try {
    logSection('Available Audio Devices');
    
    const devices = await AudioDeviceManager.listDevices();
    
    if (devices.length === 0) {
      logInfo('[DEVICES]', 'No audio devices found');
      return;
    }

    // Group by type
    const outputDevices = devices.filter(d => d.type === 'output');
    const inputDevices = devices.filter(d => d.type === 'input');

    if (outputDevices.length > 0) {
      logInfo('[OUTPUT DEVICES]', '');
      outputDevices.forEach((device, index) => {
        console.log(`  ${index + 1}. ${device.name}`);
        if (device.id !== device.name) {
          console.log(`     ID: ${device.id}`);
        }
      });
    }

    if (inputDevices.length > 0) {
      console.log('');
      logInfo('[INPUT DEVICES]', '');
      inputDevices.forEach((device, index) => {
        console.log(`  ${index + 1}. ${device.name}`);
        if (device.id !== device.name) {
          console.log(`     ID: ${device.id}`);
        }
      });
    }

    console.log('\n');
    logInfo('[USAGE]', 'To use a specific device, set the AUDIO_DEVICE environment variable:');
    console.log('  Example: AUDIO_DEVICE="CABLE-A Input (VB-Audio Virtual Cable A)"');
    console.log('  Example: AUDIO_DEVICE="Speakers (Realtek High Definition Audio)"');
    
  } catch (error) {
    logError('Failed to list audio devices', error);
  }
}

if (require.main === module) {
  listAudioDevices();
}