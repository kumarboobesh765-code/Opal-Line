import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  type CellData,
  type ColumnDef as TableColumnDef,
  type RowData,
} from '@tanstack/react-table'

export const appTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  columnFilteringFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortFns,
  filterFns,
  columnMeta: {} as { align?: 'left' | 'right' | 'center'; headerClassName?: string },
})

export type AppTableFeatures = typeof appTableFeatures

export type ColumnDef<TData extends RowData, TValue extends CellData = unknown> = TableColumnDef<
  AppTableFeatures,
  TData,
  TValue
>
