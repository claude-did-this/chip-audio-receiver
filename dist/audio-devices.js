"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioDeviceManager = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const logger_1 = require("./logger");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class AudioDeviceManager {
    static async listDevices() {
        const platform = process.platform;
        try {
            if (platform === 'win32') {
                return await this.listWindowsDevices();
            }
            else if (platform === 'darwin') {
                return await this.listMacDevices();
            }
            else if (platform === 'linux') {
                return await this.listLinuxDevices();
            }
            else {
                throw new Error(`Unsupported platform: ${platform}`);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to list audio devices', { error });
            return [];
        }
    }
    static async listWindowsDevices() {
        try {
            // Use PowerShell to list audio devices
            const command = 'powershell -Command "Get-AudioDevice -List | Select-Object -Property Name, ID, Type | ConvertTo-Json"';
            const { stdout } = await execAsync(command);
            const devices = JSON.parse(stdout);
            return devices.map((device) => ({
                id: device.ID,
                name: device.Name,
                type: device.Type.toLowerCase()
            }));
        }
        catch (error) {
            // Fallback to WMI if PowerShell AudioDevice module not available
            const command = 'powershell -Command "Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID | ConvertTo-Json"';
            const { stdout } = await execAsync(command);
            const devices = JSON.parse(stdout);
            return devices.map((device) => ({
                id: device.DeviceID,
                name: device.Name,
                type: 'output' // WMI doesn't distinguish input/output
            }));
        }
    }
    static async listMacDevices() {
        const command = 'system_profiler SPAudioDataType -json';
        const { stdout } = await execAsync(command);
        const data = JSON.parse(stdout);
        const devices = [];
        if (data.SPAudioDataType) {
            data.SPAudioDataType.forEach((item) => {
                if (item._items) {
                    item._items.forEach((device) => {
                        devices.push({
                            id: device._name,
                            name: device._name,
                            type: device.coreaudio_input_source ? 'input' : 'output'
                        });
                    });
                }
            });
        }
        return devices;
    }
    static async listLinuxDevices() {
        try {
            // Try using pactl for PulseAudio
            const { stdout } = await execAsync('pactl list short sinks');
            const devices = [];
            const lines = stdout.trim().split('\n');
            lines.forEach(line => {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    devices.push({
                        id: parts[1],
                        name: parts[1],
                        type: 'output'
                    });
                }
            });
            return devices;
        }
        catch {
            // Fallback to ALSA
            const { stdout } = await execAsync('aplay -l');
            const devices = [];
            const matches = stdout.match(/card (\d+): (.+?), device (\d+): (.+)/g);
            if (matches) {
                matches.forEach(match => {
                    const [, cardId, cardName, deviceId, deviceName] = match.match(/card (\d+): (.+?), device (\d+): (.+)/) || [];
                    if (cardId && deviceName) {
                        devices.push({
                            id: `hw:${cardId},${deviceId}`,
                            name: `${cardName} - ${deviceName}`,
                            type: 'output'
                        });
                    }
                });
            }
            return devices;
        }
    }
    static findDeviceByName(devices, searchName) {
        const searchLower = searchName.toLowerCase();
        return devices.find(device => device.name.toLowerCase().includes(searchLower));
    }
}
exports.AudioDeviceManager = AudioDeviceManager;
//# sourceMappingURL=audio-devices.js.map