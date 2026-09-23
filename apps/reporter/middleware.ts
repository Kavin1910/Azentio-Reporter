import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two jobs, both before any rendering starts:
 *  1. Refresh the Supabase session cookie so Server Components never see a
 *     stale token.
 *  2. Gate the app. Signed-out visitors are sent to /login with a real 307;
 *     signed-in visitors on /login are sent to the workspace. Doing this in
 *     the page instead would happen after streaming has begun — the browser
 *     gets a 200 and a skeleton, then a <meta refresh>. Not the same thing.
 */
const PUBLIC = [/^\/login$/, /^\/auth\//, /^\/api\//];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((re) => re.test(pathname));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url, { status: 307 });
  }
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url, { status: 307 });
  }
  return response;
}

export const config = {
  // Everything except static assets and the icon files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon[0-9]*\\.(?:svg|png)|apple-icon\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)'],
};
