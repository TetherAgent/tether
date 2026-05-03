export enum ResponseCode {
  SUCCESS = 200,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  TOKEN_ERROR = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  FIELD_VALIDATE_ERROR = 422,
  INTERNAL_SERVER_ERROR = 500
}

export enum ResponseMsg {
  SUCCESS = 'success',
  ERROR = 'error',
  TOKEN_ERROR = 'Token 异常',
  UNAUTHORIZED = '未登录或登录已失效',
  INTERNAL_SERVER_ERROR = 'Internal Server Error'
}

export type ApiResponse<T = unknown> = {
  code: number;
  msg: string;
  data: T | null;
  stack?: string;
};
