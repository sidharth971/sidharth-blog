import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { BlogHomePage } from '@/pages/BlogHomePage'
import { CategoryPage } from '@/pages/CategoryPage'
import { BlogPostPage } from '@/pages/BlogPostPage'
import { ResumePage } from '@/pages/ResumePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// Code-split: pulls in the markdown editor (CodeMirror), only needed by the
// authenticated owner, not by public visitors reading the blog/resume.
const ComposePage = lazy(() => import('@/pages/ComposePage').then((m) => ({ default: m.ComposePage })))
const CategoriesManagePage = lazy(() =>
  import('@/pages/CategoriesManagePage').then((m) => ({ default: m.CategoriesManagePage })),
)

function withSuspense(node: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      }
    >
      {node}
    </Suspense>
  )
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <BlogHomePage /> },
      { path: '/category/:categorySlug', element: <CategoryPage /> },
      { path: '/category/:categorySlug/:subcategorySlug', element: <CategoryPage /> },
      { path: '/blog/:slug', element: <BlogPostPage /> },
      { path: '/resume', element: <ResumePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/dashboard/compose', element: withSuspense(<ComposePage />) },
          { path: '/dashboard/compose/:id', element: withSuspense(<ComposePage />) },
          { path: '/dashboard/categories', element: withSuspense(<CategoriesManagePage />) },
        ],
      },
    ],
  },
])
