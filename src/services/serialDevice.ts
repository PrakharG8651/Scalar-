import type { Reading } from '../domain/types';
import { parseArduinoLine } from './measurements';

const BAUD_RATE = 9600;
interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
interface WebSerialLike { requestPort(): Promise<SerialPortLike>; }
type SerialNavigator = Navigator & { serial?: WebSerialLike };

/** Owns Web Serial I/O so UI components don't depend on browser port details. */
export class SerialDevice {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private onDisconnect: (() => void) | null = null;

  static isSupported(): boolean { return Boolean((navigator as SerialNavigator).serial); }

  async connect(onReading: (reading: Reading) => void, onDisconnect: () => void): Promise<void> {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) throw new Error('Web Serial is not available in this browser. Try Chrome or Edge on desktop.');
    const port = await serial.requestPort();
    await port.open({ baudRate: BAUD_RATE });
    this.port = port;
    this.onDisconnect = onDisconnect;
    if (!port.readable) throw new Error('The selected serial port has no readable stream.');
    const textStream = port.readable.pipeThrough(new TextDecoderStream());
    this.reader = textStream.getReader();
    void this.readLines(onReading);
  }

  private async readLines(onReading: (reading: Reading) => void): Promise<void> {
    if (!this.reader) return;
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseArduinoLine(line);
          if (parsed) onReading({ ...parsed, time: new Date().toISOString() });
        }
      }
    } catch {
      // Unplugging a USB device can reject a pending read.
    } finally {
      this.reader.releaseLock();
      this.reader = null;
      if (this.port) {
        this.port = null;
        this.onDisconnect?.();
      }
    }
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    this.onDisconnect = null;
    if (this.reader) {
      try { await this.reader.cancel(); } catch { /* Port may already be unplugged. */ }
    }
    if (port) {
      try { await port.close(); } catch { /* Port may already be unplugged. */ }
    }
  }
}
