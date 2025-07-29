#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_devices_1 = require("./audio-devices");
const logger_1 = require("./logger");
async function listAudioDevices() {
    try {
        (0, logger_1.logSection)('Available Audio Devices');
        const devices = await audio_devices_1.AudioDeviceManager.listDevices();
        if (devices.length === 0) {
            (0, logger_1.logInfo)('[DEVICES]', 'No audio devices found');
            return;
        }
        // Group by type
        const outputDevices = devices.filter(d => d.type === 'output');
        const inputDevices = devices.filter(d => d.type === 'input');
        if (outputDevices.length > 0) {
            (0, logger_1.logInfo)('[OUTPUT DEVICES]', '');
            outputDevices.forEach((device, index) => {
                console.log(`  ${index + 1}. ${device.name}`);
                if (device.id !== device.name) {
                    console.log(`     ID: ${device.id}`);
                }
            });
        }
        if (inputDevices.length > 0) {
            console.log('');
            (0, logger_1.logInfo)('[INPUT DEVICES]', '');
            inputDevices.forEach((device, index) => {
                console.log(`  ${index + 1}. ${device.name}`);
                if (device.id !== device.name) {
                    console.log(`     ID: ${device.id}`);
                }
            });
        }
        console.log('\n');
        (0, logger_1.logInfo)('[USAGE]', 'To use a specific device, set the AUDIO_DEVICE environment variable:');
        console.log('  Example: AUDIO_DEVICE="CABLE-A Input (VB-Audio Virtual Cable A)"');
        console.log('  Example: AUDIO_DEVICE="Speakers (Realtek High Definition Audio)"');
    }
    catch (error) {
        (0, logger_1.logError)('Failed to list audio devices', error);
    }
}
if (require.main === module) {
    listAudioDevices();
}
//# sourceMappingURL=list-devices.js.map