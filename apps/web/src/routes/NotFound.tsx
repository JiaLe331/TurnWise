import { Link } from 'wouter'
import { Logo } from '@/components/brand/Logo'

export function NotFound() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <Logo className="mb-6 justify-center" />
        <h1 className="m-0 font-serif text-[34px] font-normal">This page isn't on the floor.</h1>
        <p className="mt-3 text-pewter">Open one of the role views to see the tables.</p>
        <div className="mt-5 flex justify-center gap-2">
          {[
            ['/manager?source=replay', 'Manager'],
            ['/host?source=replay', 'Host'],
            ['/staff?source=replay', 'Floor staff'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-[9px] border border-rule bg-white px-3.5 py-2 font-semibold text-ink no-underline hover:bg-wash">
              {label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
