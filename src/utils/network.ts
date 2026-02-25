import { networkInterfaces } from 'os';

/**
 * Gets all local IPv4 addresses (excluding loopback)
 */
export function getLocalIPs(): string[] {
    const ips: string[] = [];
    const interfaces = networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }

    return ips;
}
