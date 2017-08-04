import React from 'react';
import { fromJS, isImmutable } from 'immutable';

import * as fetch from './fetch.js';
import { routeConfig } from './routeConfig.js';

const initialState = {
    // navbar component
    nav: {
        role: 'role',
        user: 'user',

        selectedTab: null,

        // list of unread notifications (string can contain HTML, but be careful because it is not sanitized!)
        notifications: [],
    },

    // list of UI alerts (string can contain HTML, but be careful because it is not sanitized!)
    alerts: [],

    // applicant to display in applicant view
    selectedApplicant: null,

    // application round to display
    selectedRound: null,

    // ABC view
    abcView: {
        selectedCourses: [],

        // id representing the current course panel layout in the ABC view
        // one of: 0, 1, 2, 2.1, 3, 3.1, 3.2, 3.3, 3.4, 3.5, 4
        panelLayout: 0,

        // will be populated with mappings of selected courses to their selected sort and filter fields
        panelFields: {},
    },

    // assigned view
    assignedView: {
        // will be populated with selected sort and filter fields
        selectedSortFields: [],
        selectedFilters: {},
    },

    // unassigned view
    unassignedView: {
        // will be populated with selected sort and filter fields
        selectedSortFields: [],
        selectedFilters: {},
    },

    // assignment form used by applicant view
    assignmentForm: {
        panels: [],
        tempAssignments: [],
    },

    /** DB data **/

    applicants: { fetching: 0, list: null },
    applications: { fetching: 0, list: null },
    assignments: { fetching: 0, list: null },
    courses: { fetching: 0, list: null },
    instructors: { fetching: 0, list: null },
};

class AppState {
    constructor() {
        // container for application state
        var _data = fromJS(initialState);

        // list of change listeners
        this._listeners = [];
        // notify listeners of change
        var notifyListeners = () => this._listeners.forEach(listener => listener());

        // parses a property path into a list, as expected by Immutable
        var parsePath = path =>
            path
                .split(/(\[.*?\])|\./) // split on brackets and dots
                .filter(key => key) // removed undefined elements
                .map(key => {
                    let ind = key.match(/\[(.*)\]/); // check whether the element is in brackets
                    if (ind) {
                        return eval(ind[1]);
                    }
                    return key;
                });

        // getter for appState object
        this.get = function(property) {
            let result = _data.getIn(parsePath(property));

            // apply round-based filters
            switch (property) {
                case 'applicants.list':
                    return this.getApplicantsInSelectedRound(result);

                case 'applications.list':
                    return this.getApplicationsInSelectedRound(result);

                case 'assignments.list':
                    return this.getAssignmentsInSelectedRound(result);

                case 'courses.list':
                    return this.getCoursesInSelectedRound(result);
            }

            return result;
        };

        // setters for appState object

        this.set = function(property, value) {
            // as per the Backbone Model set() syntax, we accept a property and value pair, or
            // an object with property and value pairs as keys
            if (arguments.length == 1) {
                _data = _data.withMutations(map => {
                    Object.entries(property).reduce(
                        (result, [prop, val]) => result.setIn(parsePath(prop), val),
                        map
                    );
                });
            } else {
                _data = _data.setIn(parsePath(property), value);
            }

            // notify listener(s) of change
            notifyListeners();
        };

        this.add = function(property, value) {
            _data = _data.updateIn(parsePath(property), array => array.push(value));

            // notify listener(s) of change
            notifyListeners();
        };

        this.remove = function(property, index) {
            let path = parsePath(property); // index should be the last element in the path array
            _data = _data.updateIn(path, array => array.delete(index));

            // notify listener(s) of change
            notifyListeners();
        };
    }

    // subscribe listener to change events on this model
    subscribe(listener) {
        this._listeners.push(listener);
    }

    /************************************
     ** view state getters and setters **
     ************************************/

    // apply a sort to the applicant table in a course panel (sorted up initially)
    // note that we do not allow multiple sorts on the same field (incl. in different directions)
    addCoursePanelSort(course, field) {
        if (
            !this.get('abcView.panelFields.' + course + '.selectedFilters').some(
                ([f, _]) => f == field
            )
        ) {
            this.add('abcView.panelFields.' + course + '.selectedSortFields', fromJS([field, 1]));
        } else {
            this.alert('<b>Applicant Table</b>&ensp;Cannot apply the same sort more than once.');
        }
    }

    // apply a sort to the applicant table in a single-applicant-table view (sorted up initially)
    // note that we do not allow multiple sorts on the same field (incl. in different directions)
    addSort(field) {
        let view = this.getSelectedViewStateComponent();

        if (!this.get(view + '.selectedSortFields').some(([f, _]) => f == field)) {
            this.add(view + '.selectedSortFields', fromJS([field, 1]));
        } else {
            this.alert('<b>Applicant Table</b>&ensp;Cannot apply the same sort more than once.');
        }
    }

    // add a temporary assignment through the assignment form of the applicant view
    addTempAssignment(positionId, hours) {
        this.add(
            'assignmentForm.tempAssignments',
            fromJS({ positionId: positionId, hours: hours })
        );
    }

    // add an alert to the list of active alerts
    alert(text) {
        let alerts = this.get('alerts');
        // give it an id that is 1 larger than the largest id in the array, or 0 if the array is empty
        this.add(
            'alerts',
            fromJS({
                id: alerts.size > 0 ? alerts.last().get('id') + 1 : 0,
                text: text,
            })
        );
    }

    // check whether any of the given filters in the category are selected on the applicant table in a course panel
    anyCoursePanelFilterSelected(course, field) {
        return this.get('abcView.panelFields.' + course + '.selectedFilters').has(field);
    }

    // check whether any of the given filters in the category are selected on the applicant table in a
    // single-applicant-table view
    anyFilterSelected(field) {
        let view = this.getSelectedViewStateComponent();
        return this.get(view + '.selectedFilters').has(field);
    }

    // remove all selected filters on the applicant table in a course panel
    clearCoursePanelFilters(course) {
        this.set('abcView.panelFields.' + course + '.selectedFilters', fromJS({}));
    }

    // remove all selected filters on the applicant table in a single-applicant-table view
    clearFilters() {
        let view = this.getSelectedViewStateComponent();
        this.set(view + '.selectedFilters', fromJS({}));
    }

    createAssignmentForm(panels) {
        this.set('assignmentForm.panels', panels);
    }

    dismissAlert(id) {
        let alerts = this.get('alerts');
        let i = alerts.findIndex(alert => alert.get('id') == id);

        if (i != -1) {
            this.remove('alerts', i);
        }
    }

    getAlerts() {
        return this.get('alerts');
    }

    getAssignmentForm() {
        return this.get('assignmentForm');
    }

    getCoursePanelFiltersByCourse(course) {
        return this.get('abcView.panelFields.' + course + '.selectedFilters');
    }

    getCoursePanelLayout() {
        return this.get('abcView.panelLayout');
    }

    getCoursePanelSortsByCourse(course) {
        return this.get('abcView.panelFields.' + course + '.selectedSortFields');
    }

    getCurrentUserName() {
        return this.get('nav.user');
    }

    getCurrentUserRole() {
        return this.get('nav.role');
    }

    getFilters() {
        let view = this.getSelectedViewStateComponent();
        return this.get(view + '.selectedFilters');
    }

    getSelectedApplicant() {
        return this.get('selectedApplicant');
    }

    getSelectedCourses() {
        return this.get('abcView.selectedCourses');
    }

    getSelectedNavTab() {
        return this.get('nav.selectedTab');
    }

    getSelectedRound() {
        return this.get('selectedRound');
    }

    // return the name of the appState component that corresponds to the currently selected view
    getSelectedViewStateComponent() {
        switch (this.get('nav.selectedTab')) {
            case routeConfig.abc.id:
                return 'abcView';
            case routeConfig.assigned.id:
                return 'assignedView';
            case routeConfig.unassigned.id:
                return 'unassignedView';
            default:
                return null;
        }
    }

    getSorts() {
        let view = this.getSelectedViewStateComponent();
        return this.get(view + '.selectedSortFields');
    }

    getTempAssignments() {
        return this.get('assignmentForm.tempAssignments');
    }

    getUnreadNotifications() {
        return this.get('nav.notifications');
    }

    // check whether a filter is selected on the applicant table in a course panel
    isCoursePanelFilterSelected(course, field, category) {
        let filters = this.get('abcView.panelFields.' + course + '.selectedFilters');

        return filters.has(field) && filters.get(field).includes(category);
    }

    // check whether a course in the course menu is selected
    isCourseSelected(course) {
        return this.get('abcView.selectedCourses').includes(course);
    }

    // check whether a filter is selected on the applicant table in a single-applicant-table view
    isFilterSelected(field, category) {
        let view = this.getSelectedViewStateComponent();
        let filters = this.get(view + '.selectedFilters');

        return filters.has(field) && filters.get(field).includes(category);
    }

    // check whether a panel is expanded in the applicant view
    isPanelExpanded(index) {
        return this.get('assignmentForm.panels[' + index + '].expanded');
    }

    // add a notification to the list of unread notifications
    notify(text) {
        this.add('nav.notifications', text);
    }

    // clear the list of unread notifications
    readNotifications() {
        this.set('nav.notifications', fromJS([]));
    }

    // remove a sort from the applicant table in a course panel
    removeCoursePanelSort(course, field) {
        let i = this.get('abcView.panelFields.' + course + '.selectedSortFields').findIndex(
            f => f.get(0) == field
        );
        this.remove('abcView.panelFields.' + course + '.selectedSortFields', i);
    }

    // remove a sort from the applicant table in a single-applicant-table view
    removeSort(field) {
        let view = this.getSelectedViewStateComponent();

        let i = this.get(view + '.selectedSortFields').findIndex(f => f.get(0) == field);
        this.remove(view + '.selectedSortFields', i);
    }

    // remove a temporary assignment from the assignment form of the applicant view
    removeTempAssignment(course) {
        let i = this.get('assignmentForm.tempAssignments').findIndex(
            ass => ass.get('positionId') == course
        );
        this.remove('assignmentForm.tempAssignments', i);
    }

    // select an applicant to display in the applicant view
    selectApplicant(applicant) {
        this.set('selectedApplicant', applicant);
    }

    // select a navbar tab
    selectNavTab(eventKey) {
        this.set('nav.selectedTab', eventKey);
    }

    // select a round to display
    selectRound(round) {
        this.set('selectedRound', round);
    }

    // set the course panel layout in the ABC view
    setCoursePanelLayout(layout) {
        this.set('abcView.panelLayout', layout);
    }

    selectSingleCourse(course) {
        // Note: toString() is a hack because our components think that course IDs are numbers but Immutable
        // thinks they are strings
        this.set('abcView.selectedCourses', fromJS([course.toString()]));
    }

    // change the number of hours of a temporary assignment
    setTempAssignmentHours(id, hours) {
        let i = this.get('assignmentForm.tempAssignments').findIndex(
            ass => ass.get('positionId') == id
        );
        this.set('assignmentForm.tempAssignments[' + i + '].hours', hours);
    }

    // switch the places of two courses in the course panel layout in the ABC view
    swapCoursesInLayout(course1, course2) {
        let selected = this.get('abcView.selectedCourses'),
            i1,
            i2;

        for (var i = 0; i < selected.size; i++) {
            if (selected.get(i) == course1) {
                i1 = i;
            } else if (selected.get(i) == course2) {
                i2 = i;
            }
        }

        this.set({
            ['abcView.selectedCourses[' + i1 + ']']: selected.get(i2),
            ['abcView.selectedCourses[' + i2 + ']']: selected.get(i1),
        });
    }

    // toggle a filter on the applicant table in a course panel
    toggleCoursePanelFilter(course, field, category) {
        let filters = this.get('abcView.panelFields.' + course + '.selectedFilters');

        // filter is already applied
        if (filters.has(field)) {
            let i = filters.get(field).indexOf(category);

            if (i == -1) {
                // filter on this category is not already applied
                this.add(
                    'abcView.panelFields.' + course + '.selectedFilters[' + field + ']',
                    category
                );
            } else if (filters.get(field).size > 1) {
                // filter on this category is already applied, along with other categories
                this.remove('abcView.panelFields.' + course + '.selectedFilters[' + field + ']', i);
            } else {
                // filter is only applied on this category
                this.remove('abcView.panelFields.' + course + '.selectedFilters', field);
            }
        } else {
            // filter has not been applied
            this.set(
                'abcView.panelFields.' + course + '.selectedFilters[' + field + ']',
                fromJS([category])
            );
        }
    }

    // toggle the sort direction of the sort currently applied to the applicant table in a course panel
    toggleCoursePanelSortDir(course, field) {
        let sortFields = this.get('abcView.panelFields.' + course + '.selectedSortFields');
        let i = sortFields.findIndex(f => f.get(0) == field);

        if (i != -1) {
            this.set(
                'abcView.panelFields.' + course + '.selectedSortFields[' + i + '][1]',
                -sortFields.get(i).get(1)
            );
        }
    }

    // toggle a filter on the applicant table in a single-applicant-table view
    toggleFilter(field, category) {
        let view = this.getSelectedViewStateComponent();
        let filters = this.get(view + '.selectedFilters');

        if (filters.has(field)) {
            let i = filters.get(field).indexOf(category);

            if (i == -1) {
                // filter on this category is not already applied
                this.add(view + '.selectedFilters[' + field + ']', category);
            } else if (filters.get(field).size > 1) {
                // filter on this category is already applied, along with other categories
                this.remove(view + '.selectedFilters[' + field + ']', i);
            } else {
                // filter is only applied on this category
                this.remove(view + '.selectedFilters', field);
            }
        } else {
            this.set(view + '.selectedFilters[' + field + ']', fromJS([category]));
        }
    }

    // toggle the expanded state of a panel in the applicant assignment form component
    togglePanelExpanded(index) {
        this.set('assignmentForm.panels[' + index + '].expanded', !this.isPanelExpanded(index));
    }

    // toggle the selected state of the course that is clicked
    // note that we only allow up to 4 courses to be selected in the ABC view
    toggleSelectedCourse(course) {
        let selected = this.get('abcView.selectedCourses');
        let i = selected.indexOf(course);

        if (i == -1) {
            if (selected.size < 4) {
                this.add('abcView.selectedCourses', course);
            } else {
                this.alert('<b>Courses Menu</b>&ensp;Cannot select more than 4 courses.');
            }
        } else {
            this.remove('abcView.selectedCourses', i);
        }
    }

    // toggle the sort direction of the sort currently applied to the applicant table in a single-applicant-table view
    toggleSortDir(field) {
        let view = this.getSelectedViewStateComponent();
        let sortFields = this.get(view + '.selectedSortFields');
        let i = sortFields.findIndex(f => f.get(0) == field);

        if (i != -1) {
            this.set(view + '.selectedSortFields[' + i + '][1]', -sortFields.get(i).get(1));
        }
    }

    // unselect the applicant displayed in the applicant view
    unselectApplicant() {
        this.set('selectedApplicant', null);
    }

    // check whether a panelFields object exists for each of the currently selected courses
    // if not, create the appropriate panelFields
    updateCoursePanelFields(selected) {
        let panelFields = this.get('abcView.panelFields'),
            missingCourses = [];

        for (var course of selected.values()) {
            // if a tracker is missing, create it (the course was just selected)
            if (!panelFields.has(course)) {
                missingCourses.push(course);
            }
        }

        let newPanelFields = panelFields.withMutations(map => {
            missingCourses.reduce(
                (result, course) =>
                    result.set(
                        course,
                        fromJS({
                            selectedSortFields: [],
                            selectedFilters: {},
                        })
                    ),
                map
            );
        });

        if (missingCourses.length > 0) {
            this.set('abcView.panelFields', newPanelFields);
        }
    }

    /******************************
     ** data getters and setters **
     ******************************/

    addInstructor(courseId, instructorId) {
        let val = this.get('courses.list.' + courseId + '.instructors').toJS();
        val.push(parseInt(instructorId));
        fetch.updateCourse(courseId, { instructors: val }, 'instructors');
    }

    // check if any data is being fetched
    anyFetching() {
        return [
            this.get('courses.fetching'),
            this.get('instructors.fetching'),
            this.get('applicants.fetching'),
            this.get('applications.fetching'),
            this.get('assignments.fetching'),
        ].some(val => val > 0);
    }

    // check if any data has not yet been fetched
    anyNull() {
        return [
            this.get('courses.list'),
            this.get('instructors.list'),
            this.get('applicants.list'),
            this.get('applications.list'),
            this.get('assignments.list'),
        ].some(val => val == null);
    }

    getApplicantsInSelectedRound(applicants) {
        let round = this.get('selectedRound'),
            applications = this.get('applications.list');

        if (round && applicants) {
            // list of applications should already be filtered by round
            return applicants.filter((_, id) => applications.has(id));
        } else {
            // all rounds displayed and/or no applicants exist
            return applicants;
        }
    }

    getApplicationsInSelectedRound(applications) {
        let round = this.get('selectedRound'),
            courses = this.get('courses.list'); // list of courses should already be filtered by round

        if (round && applications) {
            return (
                applications
                    .map(applicant =>
                        applicant.filter(
                            // filter out applications where at least one course was applied for, and the first course
                            // applied to is in the selected round
                            // note: this assumes that, if all courses in the application are in the same round
                            application =>
                                application.get('prefs').size == 0 ||
                                courses.has(
                                    application.get('prefs').first().get('positionId').toString()
                                )
                        )
                    )
                    // filter out applicants who have no applications in the selected round
                    .filter(applicant => applicant.size > 0)
            );
        } else {
            // all rounds displayed and/or no applications exist
            return applications;
        }
    }

    getAssignmentsInSelectedRound(assignments) {
        let round = this.get('selectedRound'),
            courses = this.get('courses.list'); // list of courses should already be filtered by round

        if (round && assignments) {
            return (
                assignments
                    .map(
                        // filter out assignments where the course is in the selected round
                        applicant =>
                            applicant.filter(assignment =>
                                courses.has(assignment.get('positionId').toString())
                            )
                    )
                    // filter out applicants who have no assignments to course(s) in the selected round
                    .filter(applicant => applicant.size > 0)
            );
        } else {
            // all rounds displayed and/or no assignments exist
            return assignments;
        }
    }

    getCoursesInSelectedRound(courses) {
        let round = this.get('selectedRound');

        if (round && courses) {
            return courses.filter(course => course.get('round') == round);
        } else {
            // all rounds displayed and/or no courses exist
            return courses;
        }
    }

    // create a new assignment
    createAssignment(applicant, course, hours) {
        fetch.postAssignment(applicant, course, hours);
    }

    // delete an assignment
    deleteAssignment(applicant, assignment) {
        fetch.deleteAssignment(applicant, assignment);
    }

    /*** NEEDS UPDATING WITH ROUNDS ***/
    // export current assignments
    exportOffers() {
        fetch.exportOffers(110);
    }

    // check if applicants are being fetched
    fetchingApplicants() {
        return this.get('applicants.fetching') > 0;
    }

    // check if applications are being fetched
    fetchingApplications() {
        return this.get('applications.fetching') > 0;
    }

    // check if assignments are being fetched
    fetchingAssignments() {
        return this.get('assignments.fetching') > 0;
    }

    // check if courses are being fetched
    fetchingCourses() {
        return this.get('courses.fetching') > 0;
    }

    // check if instructors are being fetched
    fetchingInstructors() {
        return this.get('instructors.fetching') > 0;
    }

    filterApplicantsByRound() {
        let round = this.get('selectedRound'),
            applicants = this.get('applicants.list'),
            applications = this.get('applications.list');

        if (round) {
        } else {
            // all rounds displayed, so return the entire list
            return this.get('applicants.list');
        }
    }

    // get applicants who are assigned to course; returns a list of [applicantID, applicantData]
    getApplicantsAssignedToCourse(course) {
        let assignments = this.get('assignments.list'),
            applicants = this.get('applicants.list');

        return applicants
            .filter(
                (_, app) =>
                    assignments.has(app) &&
                    assignments.get(app).some(ass => ass.get('positionId') == course)
            )
            .entrySeq();
    }

    getApplicantById(applicant) {
        return this.get('applicants.list.' + applicant);
    }

    getApplicantsList() {
        return this.get('applicants.list');
    }

    // get applicants who have applied to course; returns a list of [applicantID, applicantData]
    getApplicantsToCourse(course) {
        let applications = this.get('applications.list').filter(applicant =>
            applicant.some(application =>
                application.get('prefs').some(pref => pref.get('positionId') == course)
            )
        );

        return this.get('applicants.list').filter((_, id) => applications.has(id)).entrySeq();
    }

    // get applicants to course who are not assigned to it; returns a list of [applicantID, applicantData]
    getApplicantsToCourseUnassigned(course) {
        let assignments = this.get('assignments.list'),
            applicants = this.get('applicants.list');

        let applications = this.get('applications.list')
            // get applications to course
            .filter(applicant =>
                applicant.some(application =>
                    application.get('prefs').some(pref => pref.get('positionId') == course)
                )
            )
            // get applications to course with no corresponding assignment
            .filterNot(
                (_, applicant) =>
                    assignments.has(applicant) &&
                    assignments.get(applicant).some(ass => ass.get('positionId') == course)
            );

        return applications.map((_, applicant) => applicants.get(applicant)).entrySeq();
    }

    /*** NEEDS UPDATING WITH ROUNDS ***/
    getApplicationById(applicant) {
        return this.get('applications.list.' + applicant + '[0]');
    }

    /*** NEEDS UPDATING WITH ROUNDS ***/
    // check whether this course is a preference for this applicant
    getApplicationPreference(applicant, course) {
        let prefs = this.get('applications.list.' + applicant + '[0].prefs');

        return prefs.some(pref => pref.get('positionId') == course && pref.get('preferred'));
    }

    getApplicationsList() {
        return this.get('applications.list');
    }

    // get all applicants who have been assigned to a course; returns a list of [applicantID, applicantData]
    getAssignedApplicants() {
        let assignments = this.get('assignments.list'),
            applicants = this.get('applicants.list');

        return assignments.map((_, applicant) => applicants.get(applicant)).entrySeq();
    }

    getAssignmentByApplicant(applicant, course) {
        let assignments = this.get('assignments.list.' + applicant);

        if (assignments) {
            return assignments.find(ass => ass.get('positionId') == course);
        } else {
            return null;
        }
    }

    getAssignmentsByApplicant(applicant) {
        let assignments = this.get('assignments.list.' + applicant);

        if (assignments) {
            return assignments;
        } else {
            return fromJS([]);
        }
    }

    getAssignmentsList() {
        return this.get('assignments.list');
    }

    // get the current number of assignments to course
    getCourseAssignmentCount(course) {
        return this.get('assignments.list').filter(applicant =>
            applicant.some(ass => ass.get('positionId') == course)
        ).size;
    }

    getCoursesList() {
        return this.get('courses.list');
    }

    getCourseById(course) {
        return this.get('courses.list.' + course);
    }

    // get a sorted list of course codes
    getCourseCodes() {
        return this.get('courses.list').valueSeq().map(course => course.get('code')).sort();
    }

    getCourseCodeById(course) {
        return this.get('courses.list.' + course + '.code');
    }

    getInstructorsList() {
        return this.get('instructors.list');
    }

    // get a list of all rounds for all courses
    getRounds() {
        return this.get('courses.list').map(course => course.get('round')).flip().keySeq();
    }

    // get all applicants who have not been assigned to a course; returns a list of [applicantID, applicantData]
    getUnassignedApplicants() {
        let assignments = this.get('assignments.list'),
            applicants = this.get('applicants.list');

        applicants = applicants.withMutations(map => {
            assignments.reduce((result, _, app) => result.delete(app), map);
        });

        return applicants.entrySeq();
    }

    importChass(data) {
        fetch.importChass(data);
    }

    isApplicantsListNull() {
        return this.get('applicants.list') == null;
    }

    isApplicationsListNull() {
        return this.get('applications.list') == null;
    }

    isAssignmentsListNull() {
        return this.get('assignments.list') == null;
    }

    isCoursesListNull() {
        return this.get('courses.list') == null;
    }

    isInstructorsListNull() {
        return this.get('instructors.list') == null;
    }

    // add/update the notes for an applicant
    noteApplicant(applicant, notes) {
        fetch.noteApplicant(applicant, notes);
    }

    // persist a temporary assignment to the database
    permAssignment(course) {
        let applicant = this.get('selectedApplicant');
        let tempAssignment = this.get('assignmentForm.tempAssignments').find(
            ass => ass.get('positionId') == course
        );

        // note that there are two 'set' calls here
        this.createAssignment(applicant, course, tempAssignment.get('hours'));

        this.removeTempAssignment(course);
    }

    removeInstructor(courseId, index) {
        let val = this.get('courses.list.' + courseId + '.instructors').toJS();
        val.splice(index, 1);
        fetch.updateCourse(courseId, { instructors: val }, 'instructors');
    }

    setApplicantsList(list) {
        this.set('applicants.list', list);
    }

    setApplicationsList(list) {
        this.set('applications.list', list);
    }

    setAssignmentsList(list) {
        this.set('assignments.list', list);
    }

    setCoursesList(list) {
        this.set('courses.list', list);
    }

    setFetchingApplicantsList(fetching) {
        let init = this.get('applicants.fetching');
        if (fetching) {
            this.add('nav.notifications', '<i>Fetching applicants...</i>');
            this.set('applicants.fetching', init + 1);
        } else {
            this.set('applicants.fetching', init - 1);
        }
    }

    setFetchingApplicationsList(fetching) {
        let init = this.get('applications.fetching');
        if (fetching) {
            this.add('nav.notifications', '<i>Fetching applications...</i>');
            this.set('applications.fetching', init + 1);
        } else {
            this.set('applications.fetching', init - 1);
        }
    }

    setFetchingAssignmentsList(fetching) {
        let init = this.get('assignments.fetching');
        if (fetching) {
            this.add('nav.notifications', '<i>Fetching assignments...</i>');
            this.set('assignments.fetching', init + 1);
        } else {
            this.set('assignments.fetching', init - 1);
        }
    }

    setFetchingCoursesList(fetching) {
        let init = this.get('courses.fetching');
        if (fetching) {
            this.add('nav.notifications', '<i>Fetching courses...</i>');
            this.set('courses.fetching', init + 1);
        } else {
            this.set('courses.fetching', init - 1);
        }
    }

    setFetchingInstructorsList(fetching) {
        let init = this.get('instructors.fetching');
        if (fetching) {
            this.add('nav.notifications', '<i>Fetching instructors...</i>');
            this.set('instructors.fetching', init + 1);
        } else {
            this.set('instructors.fetching', init - 1);
        }
    }

    setInstructorsList(list) {
        this.set('instructors.list', list);
    }

    successFetchingApplicantsList() {
        this.add('nav.notifications', 'Finished fetching applicants.');
        this.setFetchingApplicantsList(false);
    }

    successFetchingApplicationsList() {
        this.add('nav.notifications', 'Finished fetching applications.');
        this.setFetchingApplicationsList(false);
    }

    successFetchingAssignmentsList() {
        this.add('nav.notifications', 'Finished fetching assignments.');
        this.setFetchingAssignmentsList(false);
    }

    successFetchingCoursesList() {
        this.add('nav.notifications', 'Finished fetching courses.');
        this.setFetchingCoursesList(false);
    }

    successFetchingInstructorsList() {
        this.add('nav.notifications', 'Finished fetching instructors.');
        this.setFetchingInstructorsList(false);
    }

    updateAssignment(applicant, assignment, hours) {
        fetch.updateAssignmentHours(applicant, assignment, hours);
    }

    unlockAssignment(applicant, assignment) {
        fetch.unlockAssignment(applicant, assignment);
    }

    updateCourse(courseId, val, props) {
        let data = {};
        switch (props) {
            case 'estimatedPositions':
                data['estimated_count'] = val;
                break;
            case 'positionHours':
                data['hours'] = val;
                break;
            case 'estimatedEnrol':
                data['estimated_enrolment'] = val;
                break;
            case 'qual':
                data['qualifications'] = val;
                break;
            case 'resp':
                data['duties'] = val;
                break;
        }
        fetch.updateCourse(courseId, data, props);
    }

    updateInstructorInput(courseId, input) {
        if (input === undefined) {
            input = '';
        }
        this.set('courses.list.' + courseId + '.instructor_input', fromJS(input));
        let visible_input = document.getElementById('input_' + courseId);
        visible_input.innerHTML = input;
    }
}

let appStateInst = new AppState(),
    appState = {};

// wrap all AppState functions in functions in appState that parse Immutable results as JS
Object.getOwnPropertyNames(Object.getPrototypeOf(appStateInst)).forEach(name => {
    // do not create a wrapper for the AppState constructor
    if (name != 'constructor') {
        appState[[name]] = (...args) => {
            // convert any object arguments to Immutable objects
            args = args.map(arg => (arg instanceof Object ? fromJS(arg) : arg));

            // pass arguments to the function
            let result = appStateInst[[name]](...args);

            // if the result of the function is an Immutable object, convert it to a JS object
            if (isImmutable(result)) {
                result = result.toJS();
            }

            return result;
        };
    }
});

export { appState };
