/** Official Siebel eScript constants plus documented legacy view aliases. */
export const SIEBEL_CONSTANTS = Object.freeze({
  // Pre-event handlers
  ContinueOperation: 1,
  CancelOperation: 2,

  // ExecuteQuery cursor mode (current Siebel eScript values)
  ForwardBackward: 256,
  ForwardOnly: 257,

  // NewRecord position
  NewBefore: 0,
  NewAfter: 1,
  NewBeforeCopy: 2,
  NewAfterCopy: 3,

  // Business Component view mode
  SalesRepView: 0,
  ManagerView: 1,
  PersonalView: 2,
  AllView: 3,
  NoneSetView: 4,
  OrganizationView: 5,
  ContactView: 6,
  GroupView: 7,
  CatalogView: 8,
  SubOrganizationView: 9,

  // Names found in older APIs/documentation; kept as compatibility aliases.
  NoneView: 4,
  NoneSetViewMode: 4,
  OperationComplete: 2
});
