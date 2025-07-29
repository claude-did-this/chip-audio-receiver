export interface AudioDevice {
    id: string;
    name: string;
    type: 'input' | 'output';
}
export declare class AudioDeviceManager {
    static listDevices(): Promise<AudioDevice[]>;
    private static listWindowsDevices;
    private static listMacDevices;
    private static listLinuxDevices;
    static findDeviceByName(devices: AudioDevice[], searchName: string): AudioDevice | undefined;
}
//# sourceMappingURL=audio-devices.d.ts.map