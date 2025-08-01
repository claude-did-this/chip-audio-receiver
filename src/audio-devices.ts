import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { WindowsAudioDevice, WindowsWMIDevice, MacAudioData, MacAudioDevice, MacAudioItem } from './types';

const execAsync = promisify(exec);

export interface AudioDevice {
  id: string;
  name: string;
  type: 'input' | 'output';
}

export class AudioDeviceManager {
  static async listDevices(): Promise<AudioDevice[]> {
    const platform = process.platform;
    
    try {
      if (platform === 'win32') {
        return await this.listWindowsDevices();
      } else if (platform === 'darwin') {
        return await this.listMacDevices();
      } else if (platform === 'linux') {
        return await this.listLinuxDevices();
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      logger.error('Failed to list audio devices', { error });
      return [];
    }
  }

  private static async listWindowsDevices(): Promise<AudioDevice[]> {
    try {
      // Use PowerShell to list audio devices
      const command = 'powershell -Command "Get-AudioDevice -List | Select-Object -Property Name, ID, Type | ConvertTo-Json"';
      const { stdout } = await execAsync(command);
      
      const devices = JSON.parse(stdout) as WindowsAudioDevice[];
      return devices.map((device: WindowsAudioDevice) => ({
        id: device.ID,
        name: device.Name,
        type: device.Type.toLowerCase() as 'input' | 'output'
      }));
    } catch (error) {
      // Fallback to WMI if PowerShell AudioDevice module not available
      const command = 'powershell -Command "Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID | ConvertTo-Json"';
      const { stdout } = await execAsync(command);
      
      const devices = JSON.parse(stdout) as WindowsWMIDevice[];
      return devices.map((device: WindowsWMIDevice) => ({
        id: device.DeviceID,
        name: device.Name,
        type: 'output' // WMI doesn't distinguish input/output
      }));
    }
  }

  private static async listMacDevices(): Promise<AudioDevice[]> {
    const command = 'system_profiler SPAudioDataType -json';
    const { stdout } = await execAsync(command);
    
    const data = JSON.parse(stdout) as MacAudioData;
    const devices: AudioDevice[] = [];
    
    if (data.SPAudioDataType) {
      data.SPAudioDataType.forEach((item: MacAudioItem) => {
        if (item._items) {
          item._items.forEach((device: MacAudioDevice) => {
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

  private static async listLinuxDevices(): Promise<AudioDevice[]> {
    try {
      // Try using pactl for PulseAudio
      const { stdout } = await execAsync('pactl list short sinks');
      const devices: AudioDevice[] = [];
      
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
    } catch {
      // Fallback to ALSA
      const { stdout } = await execAsync('aplay -l');
      const devices: AudioDevice[] = [];
      
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

  static findDeviceByName(devices: AudioDevice[], searchName: string): AudioDevice | undefined {
    const searchLower = searchName.toLowerCase();
    return devices.find(device => 
      device.name.toLowerCase().includes(searchLower)
    );
  }
}