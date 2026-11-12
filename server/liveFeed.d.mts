interface RequestLike {
  method?: string;
  url?: string;
  on(event: string, listener: (...args: any[]) => void): this;
  destroy?(): void;
}

interface ResponseLike {
  headersSent?: boolean;
  writeHead(status: number, headers?: Record<string, string>): this;
  write(value: string): boolean;
  end(value?: string | Uint8Array): this;
  flushHeaders?(): void;
  on(event: string, listener: () => void): this;
}

export function createLiveFeed(): {
  handle(request: RequestLike, response: ResponseLike): Promise<boolean>;
};
