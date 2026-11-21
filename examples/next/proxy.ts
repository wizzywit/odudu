import { withAuth } from '@odudu-io/next';

export const proxy = withAuth({ paths: ['/dashboard'] });

export const config = { matcher: ['/dashboard/:path*'] };
