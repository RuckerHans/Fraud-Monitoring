import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { AuthenticatedUser, Branch, ReportParams, ReportResponse } from '@/lib/types';

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function errorMessage(error: FetchBaseQueryError): string {
  if ('data' in error && error.data && typeof error.data === 'object') {
    const message = (error.data as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message.join(' ');
    if (message) return message;
  }
  if ('error' in error && error.error) return error.error;
  return `Request failed with status ${String(error.status)}.`;
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl,
    credentials: 'include',
    prepareHeaders(headers) {
      if (typeof window !== 'undefined') {
        const token = window.localStorage.getItem('fraud-monitoring-token');
        if (token) headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: ['Auth', 'Branches'],
  endpoints: (builder) => ({
    getMe: builder.query<AuthenticatedUser, void>({
      query: () => '/auth/me',
      providesTags: ['Auth'],
    }),
    getBranches: builder.query<Branch[], void>({
      query: () => '/branches',
      providesTags: ['Branches'],
    }),
    getTransactions: builder.query<ReportResponse, ReportParams>({
      async queryFn({ branchIds, ...params }, _queryApi, _extraOptions, fetchWithBQ) {
        const results = await Promise.all(
          branchIds.map(async (branchId) => ({
            branchId,
            result: await fetchWithBQ({
              url: '/reports/transactions',
              params: { ...params, branchIds: branchId },
            }),
          })),
        );

        const reports: ReportResponse[] = [];
        const warnings: string[] = [];
        let firstError: FetchBaseQueryError | undefined;

        for (const { branchId, result } of results) {
          if (result.error) {
            firstError ??= result.error;
            warnings.push(`Branch ${branchId}: ${errorMessage(result.error)}`);
            continue;
          }
          const response = result.data as ReportResponse;
          reports.push(response);
          warnings.push(...response.warnings);
        }

        if (reports.length === 0) {
          return {
            error: firstError ?? {
              status: 'CUSTOM_ERROR',
              error: 'No branch report request completed.',
            },
          };
        }

        const data = reports
          .flatMap((report) => report.data)
          .sort((left, right) => {
            const dateOrder =
              new Date(right.logDate).getTime() - new Date(left.logDate).getTime();
            return dateOrder || right.transactionNo.localeCompare(left.transactionNo);
          });

        return {
          data: {
            data,
            meta: {
              page: params.page,
              pageSize: params.pageSize,
              total: reports.reduce((sum, report) => sum + report.meta.total, 0),
              // Every branch is paged independently, so the combined report remains
              // available while at least one branch has another page.
              totalPages: Math.max(...reports.map((report) => report.meta.totalPages)),
            },
            assumptions: [...new Set(reports.flatMap((report) => report.assumptions))],
            warnings,
          },
        };
      },
    }),
    login: builder.mutation<Record<string, unknown>, { username: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
  }),
});

export const {
  useGetMeQuery,
  useLazyGetMeQuery,
  useGetBranchesQuery,
  useGetTransactionsQuery,
  useLazyGetTransactionsQuery,
  useLoginMutation,
} = api;
export { baseUrl };
