import axios, {AxiosInstance, AxiosRequestConfig} from 'axios';

const DEFAULT_SERVER = 'http://localhost:8080';

// Trino headers
const TRINO_HEADER_PREFIX = 'X-Trino-';
const TRINO_PREPARED_STATEMENT_HEADER =
  TRINO_HEADER_PREFIX + 'Prepared-Statement';
const TRINO_USER_HEADER = TRINO_HEADER_PREFIX + 'User';
const TRINO_SOURCE_HEADER = TRINO_HEADER_PREFIX + 'Source';
const TRINO_CATALOG_HEADER = TRINO_HEADER_PREFIX + 'Catalog';
const TRINO_SCHEMA_HEADER = TRINO_HEADER_PREFIX + 'Schema';
const TRINO_SESSION_HEADER = TRINO_HEADER_PREFIX + 'Session';
const TRINO_SET_CATALOG_HEADER = TRINO_HEADER_PREFIX + 'Set-Catalog';
const TRINO_SET_SCHEMA_HEADER = TRINO_HEADER_PREFIX + 'Set-Schema';
const TRINO_SET_PATH_HEADER = TRINO_HEADER_PREFIX + 'Set-Path';
const TRINO_SET_SESSION_HEADER = TRINO_HEADER_PREFIX + 'Set-Session';
const TRINO_CLEAR_SESSION_HEADER = TRINO_HEADER_PREFIX + 'Clear-Session';
const TRINO_SET_ROLE_HEADER = TRINO_HEADER_PREFIX + 'Set-Role';
const TRINO_EXTRA_CREDENTIAL_HEADER = TRINO_HEADER_PREFIX + 'Extra-Credential';

export class ConnectionOptions {
  constructor(server: string, catalog?: string, schema?: string);
  constructor(
    readonly server?: string,
    readonly catalog?: string,
    readonly schema?: string,
    readonly user?: string,
    readonly password?: string
  ) {}
}

type QueryStage = {
  stageId: string;
  state: string;
  done: boolean;
  nodes: number;
  totalSplits: number;
  queuedSplits: number;
  runningSplits: number;
  completedSplits: number;
  cpuTimeMillis: number;
  wallTimeMillis: number;
  processedRows: number;
  processedBytes: number;
  physicalInputBytes: number;
  failedTasks: number;
  coordinatorOnly: boolean;
  subStages: QueryStage[];
};

type QueryStats = {
  state: string;
  queued: boolean;
  scheduled: boolean;
  nodes: number;
  totalSplits: number;
  queuedSplits: number;
  runningSplits: number;
  completedSplits: number;
  cpuTimeMillis: number;
  wallTimeMillis: number;
  queuedTimeMillis: number;
  elapsedTimeMillis: number;
  processedRows: number;
  processedBytes: number;
  physicalInputBytes: number;
  peakMemoryBytes: number;
  spilledBytes: number;
  rootStage: QueryStage;
  progressPercentage: number;
};

export type QueryResult = {
  id: string;
  infoUri?: string;
  nextUri?: string;
  columns?: {name: string; type: string}[];
  data?: any[][];
  stats?: QueryStats;
  warnings?: string[];
};

class Result {
  constructor(
    private readonly client: TrinoClient,
    readonly queryResult: QueryResult
  ) {}

  async next(): Promise<Result> {
    if (!this.queryResult.nextUri) {
      return Promise.resolve(this);
    }

    const result = await this.client.request({url: this.queryResult.nextUri});
    if (!result.data || result.data.length === 0) {
      if (result.nextUri) {
        return new Result(this.client, result).next();
      }
    }

    return Promise.resolve(new Result(this.client, result));
  }

  async close(): Promise<Result> {
    const resp = await this.client.cancel(this.queryResult.id);
    return new Result(this.client, resp);
  }
}

class TrinoClient {
  private readonly underlying: AxiosInstance;

  constructor(private readonly options: ConnectionOptions) {
    this.underlying = axios.create({
      baseURL: options.server ?? DEFAULT_SERVER,
      headers: {
        [TRINO_USER_HEADER]: options.user ?? process.env.USER ?? '',
        [TRINO_SOURCE_HEADER]: 'trino-js-client',
        [TRINO_CATALOG_HEADER]: options.catalog ?? '',
        [TRINO_SCHEMA_HEADER]: options.schema ?? '',
      },
    });
  }

  async request(cfg: AxiosRequestConfig<any>): Promise<QueryResult> {
    const request = this.underlying.request(cfg);
    return request.then(response => response.data);
  }

  async query(query: string): Promise<QueryResult> {
    return this.request({method: 'POST', url: '/v1/statement', data: query});
  }

  async cancel(queryId: string): Promise<QueryResult> {
    return this.request({url: `/v1/query/${queryId}`, method: 'DELETE'});
  }
}

export class Trino {
  private readonly client: TrinoClient;

  constructor(private readonly options: ConnectionOptions) {
    this.client = new TrinoClient(options);
  }

  async query(query: string): Promise<Result> {
    return this.client.query(query).then(resp => new Result(this.client, resp));
  }

  async cancel(queryId: string): Promise<Result> {
    return this.client
      .cancel(queryId)
      .then(resp => new Result(this.client, resp));
  }
}
