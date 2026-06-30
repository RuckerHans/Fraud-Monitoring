import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { AuthenticatedUser, Branch, ReportParams, ReportResponse } from '@/lib/types';

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6060/api';

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
      query: ({ branchIds, ...params }) => ({
        url: '/reports/transactions',
        params: { ...params, branchIds: branchIds.join(',') },
      }),
    }),
    login: builder.mutation<Record<string, unknown>, { username: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
  }),
});

export const {
  useGetMeQuery,
  useGetBranchesQuery,
  useGetTransactionsQuery,
  useLoginMutation,
} = api;
export { baseUrl };
