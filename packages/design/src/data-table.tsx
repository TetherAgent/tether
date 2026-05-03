import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowData,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react'
import * as React from 'react'

import { Button } from './button'
import { cn } from './lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

type StickyColumnConfig = {
  left?: string[]
  right?: string[]
}

type DataTableProps<TData extends RowData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  loading?: boolean
  pageSize?: number
  emptyText?: string
  className?: string
  minWidth?: number | string
  maxBodyHeight?: number | string
  stickyColumns?: StickyColumnConfig
  stickyHeader?: boolean
  mobileColumnScale?: number
  enableSorting?: boolean
  surface?: 'default' | 'card' | 'plain'
  surfaceClassName?: string
  density?: 'default' | 'compact'
  fillHeight?: boolean
  skeletonRowCount?: number
  rowHover?: boolean
}

function DataTable<TData extends RowData, TValue>({
  columns,
  data,
  loading = false,
  pageSize = 20,
  emptyText = '暂无数据',
  className,
  minWidth,
  maxBodyHeight,
  stickyColumns,
  stickyHeader = false,
  mobileColumnScale = 0.65,
  enableSorting = false,
  surface = 'default',
  surfaceClassName = 'bg-card',
  density = 'default',
  fillHeight = false,
  skeletonRowCount = 3,
  rowHover = true,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [{ hasHorizontalOverflow, canScrollLeft, canScrollRight }, setScrollState] = React.useState({
    hasHorizontalOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  })
  const isMobile = useIsMobile()
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    enableSorting,
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })
  const visibleColumns = table.getVisibleLeafColumns()
  const columnScale = isMobile ? mobileColumnScale : 1
  const getColumnSize = (size: number) => Math.max(56, Math.round(size * columnScale))
  const tableMinWidth =
    typeof minWidth === 'number' && isMobile ? Math.round(minWidth * columnScale) : minWidth
  const pageCount = table.getPageCount() || 1
  const showPagination = pageCount > 1
  const loadingRowCount = Math.max(1, skeletonRowCount)
  const surfaceClassMap = {
    default: 'min-w-0 overflow-hidden rounded-lg border border-border shadow-card',
    card: 'min-w-0 overflow-hidden rounded-none border-0 shadow-none',
    plain: 'min-w-0 overflow-hidden rounded-none border-0 bg-transparent shadow-none',
  } as const

  React.useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const updateScrollState = () => {
      const maxScrollLeft = element.scrollWidth - element.clientWidth
      const hasOverflow = maxScrollLeft > 1
      const scrollLeft = element.scrollLeft

      setScrollState({
        hasHorizontalOverflow: hasOverflow,
        canScrollLeft: hasOverflow && scrollLeft > 1,
        canScrollRight: hasOverflow && scrollLeft < maxScrollLeft - 1,
      })
    }

    updateScrollState()
    element.addEventListener('scroll', updateScrollState, { passive: true })

    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(element)

    return () => {
      element.removeEventListener('scroll', updateScrollState)
      resizeObserver.disconnect()
    }
  }, [data.length, visibleColumns.length, isMobile, mobileColumnScale, minWidth])

  const getColumnOffset = (columnId: string, side: 'left' | 'right') => {
    const stickyIds = stickyColumns?.[side] || []
    const index = stickyIds.indexOf(columnId)
    if (index < 0) {
      return undefined
    }

    const ids = side === 'left' ? stickyIds.slice(0, index) : stickyIds.slice(index + 1)
    return ids.reduce((offset, id) => {
      const column = visibleColumns.find((item) => item.id === id)
      return offset + (column ? getColumnSize(column.getSize()) : 0)
    }, 0)
  }

  const getStickyClassName = (columnId: string, side: 'left' | 'right', isHeader = false) => {
    const stickyIds = stickyColumns?.[side] || []
    if (!stickyIds.includes(columnId)) {
      return ''
    }

    return cn(
      'sticky',
      surfaceClassName,
      isHeader ? 'z-30' : 'z-[1]',
      hasHorizontalOverflow &&
        side === 'left' &&
        canScrollLeft &&
        columnId === stickyIds[stickyIds.length - 1] &&
        'shadow-[8px_0_12px_-12px_rgba(0,0,0,0.7)]',
      hasHorizontalOverflow &&
        side === 'right' &&
        canScrollRight &&
        columnId === stickyIds[0] &&
        'shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.7)]',
    )
  }

  const getStickyStyle = (columnId: string, side: 'left' | 'right') => {
    const offset = getColumnOffset(columnId, side)
    if (offset === undefined) {
      return {}
    }
    return { [side]: offset }
  }

  return (
    <div
      className={cn(
        surfaceClassMap[surface],
        fillHeight && 'flex h-full flex-col',
        surface !== 'plain' && surfaceClassName,
        className,
      )}
    >
      <div
        ref={scrollRef}
        className={cn('max-w-full overflow-auto', fillHeight && 'min-h-0 flex-1')}
        style={{
          maxHeight: maxBodyHeight,
        }}
      >
        <Table
          density={density}
          style={{ minWidth: tableMinWidth, height: fillHeight ? '100%' : undefined }}
        >
          <colgroup>
            {visibleColumns.map((column) => (
              <col key={column.id} style={{ width: getColumnSize(column.getSize()) }} />
            ))}
          </colgroup>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortState = header.column.getIsSorted()
                  const columnId = header.column.id
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'whitespace-nowrap',
                        density === 'compact' && 'h-9 px-3 text-xs',
                        surfaceClassName,
                        stickyHeader && 'sticky top-0 z-20',
                        getStickyClassName(columnId, 'left', true),
                        getStickyClassName(columnId, 'right', true),
                      )}
                      style={{
                        width: getColumnSize(header.getSize()),
                        ...getStickyStyle(columnId, 'left'),
                        ...getStickyStyle(columnId, 'right'),
                      }}
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm text-left transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.99] disabled:cursor-default disabled:opacity-70',
                            header.column.getCanSort() && 'cursor-pointer hover:text-brand-text',
                          )}
                          disabled={!header.column.getCanSort()}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <>
                              {sortState === 'asc' && <ArrowUp className="h-3.5 w-3.5 text-brand-text" />}
                              {sortState === 'desc' && <ArrowDown className="h-3.5 w-3.5 text-brand-text" />}
                              {!sortState && <ArrowUpDown className="h-3.5 w-3.5 text-foreground-tertiary" />}
                            </>
                          )}
                        </button>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: loadingRowCount }, (_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`} className="hover:bg-transparent">
                  {visibleColumns.map((column, columnIndex) => {
                    const columnId = column.id
                    return (
                      <TableCell
                        key={`${columnId}-skeleton-${rowIndex}`}
                        className={cn(
                          'overflow-hidden',
                          density === 'compact' && 'h-11 px-3',
                          surfaceClassName,
                          getStickyClassName(columnId, 'left'),
                          getStickyClassName(columnId, 'right'),
                        )}
                        style={{
                          width: getColumnSize(column.getSize()),
                          ...getStickyStyle(columnId, 'left'),
                          ...getStickyStyle(columnId, 'right'),
                        }}
                      >
                        <div
                          className={cn(
                            'h-4 animate-pulse rounded bg-muted',
                            columnIndex === 0 && 'w-2/3',
                            columnIndex > 0 && columnIndex < visibleColumns.length - 1 && 'w-3/4',
                            columnIndex === visibleColumns.length - 1 && 'w-1/2',
                          )}
                        />
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className={!rowHover ? 'hover:bg-transparent' : undefined}>
                  {row.getVisibleCells().map((cell) => {
                    const columnId = cell.column.id
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'overflow-hidden',
                          density === 'compact' && 'h-11 px-3',
                          surfaceClassName,
                          getStickyClassName(columnId, 'left'),
                          getStickyClassName(columnId, 'right'),
                        )}
                        style={{
                          width: getColumnSize(cell.column.getSize()),
                          ...getStickyStyle(columnId, 'left'),
                          ...getStickyStyle(columnId, 'right'),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-foreground-tertiary">
                    <Inbox className="h-7 w-7" />
                    <span>{emptyText}</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {showPagination ? (
        <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-sm text-muted-foreground">
          <span>
            第 {table.getState().pagination.pageIndex + 1} / {pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(query.matches)

    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isMobile
}

export { DataTable, type DataTableProps }
