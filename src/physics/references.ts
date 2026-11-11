/** Real areas for the Tab 2 scale panel. Values are from the spec, not estimated. */

export interface ReferenceArea {
  id: string;
  label: string;
  m2: number;
}

export const REFERENCE_AREAS: ReferenceArea[] = [
  { id: 'football', label: 'American football field', m2: 5351 },
  { id: 'centralpark', label: 'Central Park, NYC', m2: 3.41e6 },
  { id: 'manhattan', label: 'Manhattan (land)', m2: 59.1e6 },
  { id: 'sf', label: 'San Francisco (land)', m2: 121.4e6 },
  { id: 'ri', label: 'Rhode Island (land)', m2: 2678e6 },
  { id: 'ct', label: 'Connecticut (land)', m2: 12542e6 },
  { id: 'spacex', label: 'SpaceX AI satellite (stated)', m2: 800 },
];
