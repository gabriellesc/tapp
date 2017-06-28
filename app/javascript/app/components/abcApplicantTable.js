import React from 'react'
import { Table } from 'react-bootstrap'

const THeader = props => (
	<thead><tr>
	{props.fields.map((field, i) => <th key={'header-'+i}>{field}</th>)}
    </tr></thead>
);

const ApplicantRow = props => (
	<tr key={props.id+'-row'}>
	{props.fields.map(field => (
		<td key={props.id+field}>
		{field == 'assigned' ? <input type='checkbox' defaultChecked={props.assigned}/> : props.applicant[field]}
	    </td>
	))}
	</tr>
);

class ABCApplicantTable extends React.Component {
    render() {
	if (!this.props.applicants.list)
	    return null;

	return (
		<Table striped bordered condensed hover>
		<THeader fields={this.props.tableHeaders}/>
		<tbody>
		{Object.entries(this.props.applicants.list).map(
		    ([key, val]) => (
			    <ApplicantRow key={'applicant-'+key} applicant={val} id={'applicant-'+key}
			assigned={this.props.assigned} fields={this.props.tableFields}/>
		))}
	    </tbody>
	    </Table>
	);
    }
}

export { ABCApplicantTable };
