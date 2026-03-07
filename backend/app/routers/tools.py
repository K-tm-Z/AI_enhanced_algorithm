from langchain_core.tools import tool


class ExtractionAgentTools:

    @tool
    def log_distribution_record(
        staff_name: str,
        recipient_category: str,
        item_type: str,
        quantity: int = 1,
    ) -> str:
        """
        Record a generic distribution or assistance event.
        """
        return (
            f"DATABASE_SUCCESS: Distribution record logged by {staff_name} "
            f"for recipient category {recipient_category}; item={item_type}; quantity={quantity}."
        )

    @tool
    def log_incident_report(
        report_id: str,
        category: str,
        summary: str,
        asset_id: str,
        staff_id: str,
        external_party_a: bool = False,
        external_party_b: bool = False,
    ) -> str:
        """
        Record a generic operational incident report.
        """
        return (
            f"RECORDS_UPDATED: Report {report_id} ({category}) filed by staff {staff_id}. "
            f"ExternalA: {external_party_a}, ExternalB: {external_party_b}."
        )